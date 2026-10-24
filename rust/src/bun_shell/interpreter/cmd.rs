//! The `Cmd` state (Bun's `states/Cmd.rs`; MIT, Copyright (c) Oven-sh /
//! Jarred Sumner), ported by way of the `cmd`, `runBuiltin` and
//! `runExternal` methods of `js/src/bun-shell/interpreter.mjs`: expand the
//! words and the redirect target, then run a builtin or an external command
//! with its redirections.

use std::fs::File;
use std::sync::{Arc, Mutex};

use super::{ExecResult, Interpreter};
use crate::bun_shell::builtin::{
    open_redirect_file, which, Builtin, BuiltinIn, BuiltinKind, BuiltinOut,
};
use crate::bun_shell::builtins;
use crate::bun_shell::env::{path_env, ShellExecEnv};
use crate::bun_shell::expansion::ExpandOpts;
use crate::bun_shell::io::{redirect_flags as rf, Reader, ShellIO, Writer};
use crate::bun_shell::parser::{Atom, Cmd, Redirect, SimpleAtom};
use crate::bun_shell::subprocess::{
    is_batch_file, run_subprocess, Dup, InOverride, OutOverride, Overrides, SubprocessOptions,
    SubprocessResult,
};
use crate::bun_shell::{OutBuffer, ShellError, ShellValue};

/// `export` (a declaration utility: its assignment-word arguments are
/// expanded like assignments).
fn is_declaration_utility(atom: Option<&Atom>) -> bool {
    matches!(atom, Some(Atom::Simple(SimpleAtom::Text(t))) if t == "export")
}

/// `NAME=...` (a valid variable name before the first `=`).
fn is_assignment_word(atom: &Atom) -> bool {
    let Some(SimpleAtom::Text(text)) = atom.atoms().first() else {
        return false;
    };
    let Some(eq) = text.find('=') else {
        return false;
    };
    let name = &text[..eq];
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Characters `cmd.exe` would interpret in a batch file's arguments.
fn has_cmd_exe_special(arg: &str) -> bool {
    arg.chars()
        .any(|c| matches!(c, '&' | '|' | '<' | '>' | '^' | '%' | '"' | '\r' | '\n'))
}

/// A JS byte buffer as an output buffer (writes to a `Bytes` value land in
/// a private copy, like writing into a JS `Uint8Array` nobody reads).
fn out_buffer(value: &ShellValue) -> Option<OutBuffer> {
    match value {
        ShellValue::OutBuffer(b) => Some(b.clone()),
        ShellValue::Bytes(bytes) => Some(OutBuffer(Arc::new(Mutex::new(bytes.clone())))),
        _ => None,
    }
}

fn in_bytes(value: &ShellValue) -> Option<Vec<u8>> {
    match value {
        ShellValue::OutBuffer(b) => Some(b.contents()),
        ShellValue::Bytes(bytes) => Some(bytes.clone()),
        _ => None,
    }
}

fn unknown_js_value(value: &ShellValue) -> ShellError {
    ShellError::system(format!("Unknown JS value used in shell: {value:?}"))
}

/// Bun's `set_stdio_from_redirect`.
fn redirect_overrides_for_file(flags: u8, file: File) -> Overrides {
    let file = Arc::new(file);
    let mut o = Overrides::default();
    if flags & rf::STDIN != 0 {
        o.stdin = Some(InOverride::File(Arc::clone(&file)));
    }
    if flags & rf::DUPLICATE_OUT != 0 {
        o.stdout = Some(OutOverride::File(Arc::clone(&file)));
        o.stderr = Some(OutOverride::File(file));
    } else {
        if flags & rf::STDOUT != 0 {
            o.stdout = Some(OutOverride::File(Arc::clone(&file)));
        }
        if flags & rf::STDERR != 0 {
            o.stderr = Some(OutOverride::File(file));
        }
    }
    o
}

/// A builtin's redirected stdio (`None`: keep the command's IO).
#[derive(Default)]
struct BuiltinRedirect {
    stdin: Option<BuiltinIn>,
    stdout: Option<BuiltinOut>,
    stderr: Option<BuiltinOut>,
    /// `2>&1` (`Some(true)`: stderr = stdout) / `1>&2` (`Some(false)`).
    dup_to_stdout: Option<bool>,
}

impl Interpreter {
    /// Note: like Bun (and the JS port), command-local assignments
    /// (`FOO=bar cmd`) are never cleared, so they stay visible to later
    /// commands in the same environment (`bunshell/export-var-to-buffers`).
    pub(super) async fn cmd(
        &self,
        node: &Cmd,
        shell: &mut ShellExecEnv,
        io: &ShellIO,
    ) -> ExecResult {
        if !node.assigns.is_empty() {
            let code = self.assigns(&node.assigns, shell, true).await?;
            if code != 0 {
                return Ok(code);
            }
        }

        let mut redirect_file = None;
        if let Some(Redirect::Atom(atom)) = &node.redirect_file {
            match self.expand(atom, shell, ExpandOpts::default()).await {
                Ok(out) => {
                    redirect_file = Some(if out.bounds.is_empty() {
                        out.buf
                    } else {
                        String::new()
                    })
                }
                Err(e) => {
                    let msg = format!("{}\n", e.display()?);
                    return self.cmd_write_failing_error(io, shell, &msg).await;
                }
            }
        }

        let mut args: Vec<String> = Vec::new();
        let mut exit_code = None;
        let declaration = is_declaration_utility(node.name_and_args.first());
        for (idx, atom) in node.name_and_args.iter().enumerate() {
            let opts = ExpandOpts {
                is_assign: false,
                assign_ctx: idx > 0 && declaration && is_assignment_word(atom),
            };
            let out = match self.expand(atom, shell, opts).await {
                Ok(out) => out,
                Err(e) => {
                    let msg = format!("{}\n", e.display()?);
                    return self.cmd_write_failing_error(io, shell, &msg).await;
                }
            };
            if node.name_and_args.len() == 1
                && matches!(atom, Atom::Simple(SimpleAtom::CmdSubst(_)))
            {
                exit_code = out.out_exit_code;
            }
            if !out.bounds.is_empty() {
                args.extend(out.words());
            } else if !out.buf.is_empty() || out.has_quoted_empty {
                args.push(out.buf);
            }
        }

        if args.first().is_none_or(String::is_empty) {
            return Ok(exit_code.unwrap_or(0));
        }
        match BuiltinKind::from_argv0(&args[0]).filter(|k| builtins::implemented(*k)) {
            Some(kind) => {
                self.run_builtin(kind, args, node, redirect_file, shell, io)
                    .await
            }
            None => {
                self.run_external(args, node, redirect_file, shell, io)
                    .await
            }
        }
    }

    fn jsobj(&self, idx: usize) -> Result<&ShellValue, ShellError> {
        self.jsobjs
            .get(idx)
            .ok_or_else(|| ShellError::system("Invalid JS object reference in shell"))
    }

    async fn run_builtin(
        &self,
        kind: BuiltinKind,
        mut args: Vec<String>,
        node: &Cmd,
        redirect_file: Option<String>,
        shell: &mut ShellExecEnv,
        io: &ShellIO,
    ) -> ExecResult {
        let flags = node.redirect.bits();
        let mut r = BuiltinRedirect::default();
        match &node.redirect_file {
            Some(Redirect::Atom(_)) => {
                let file = redirect_file.unwrap_or_default();
                if file.is_empty() {
                    let msg = format!("bun: ambiguous redirect: at `{}`\n", kind.as_str());
                    return self.cmd_write_failing_error(io, shell, &msg).await;
                }
                let fd = match open_redirect_file(&shell.cwd, &file, flags) {
                    Ok(fd) => fd,
                    Err(e) => {
                        let msg = format!("bun: {}: {file}", e.message());
                        return self.cmd_write_failing_error(io, shell, &msg).await;
                    }
                };
                if flags & rf::STDIN != 0 {
                    r.stdin = Some(BuiltinIn::Fd(Reader::file(fd)));
                } else if flags & (rf::STDOUT | rf::STDERR) != 0 {
                    let writer = Writer::file(fd);
                    let out = || BuiltinOut::Fd {
                        writer: writer.clone(),
                        captured: None,
                    };
                    if flags & rf::STDOUT != 0 {
                        r.stdout = Some(out());
                    }
                    if flags & rf::STDERR != 0 {
                        r.stderr = Some(out());
                    }
                }
            }
            Some(Redirect::JsBuf(idx)) => {
                let value = self.jsobj(*idx)?;
                let Some(buf) = out_buffer(value) else {
                    return Err(unknown_js_value(value));
                };
                if flags & rf::STDIN != 0 {
                    r.stdin = Some(BuiltinIn::ArrayBuf(buf.contents()));
                }
                if flags & rf::STDOUT != 0 {
                    r.stdout = Some(BuiltinOut::array_buf(buf.clone()));
                }
                if flags & rf::STDERR != 0 {
                    r.stderr = Some(BuiltinOut::array_buf(buf));
                }
            }
            None if flags & rf::DUPLICATE_OUT != 0 => {
                if flags & rf::STDOUT != 0 {
                    r.dup_to_stdout = Some(true);
                }
                if flags & rf::STDERR != 0 {
                    r.dup_to_stdout = Some(false);
                }
            }
            None => {}
        }

        args.remove(0);
        let mut b = Builtin::new(kind, args, shell, io);
        if let Some(stdin) = r.stdin {
            b.stdin = stdin;
        }
        if let Some(stdout) = r.stdout {
            b.stdout = stdout;
        }
        if let Some(stderr) = r.stderr {
            b.stderr = stderr;
        }
        match r.dup_to_stdout {
            Some(true) => b.stderr = b.stdout.clone(),
            Some(false) => b.stdout = b.stderr.clone(),
            None => {}
        }
        Ok(builtins::run(&mut b).await)
    }

    /// A JS redirect target of an external command as subprocess overrides
    /// (Bun's `init_subproc_redirections`).
    fn subproc_js_redirect(&self, value: &ShellValue, flags: u8) -> Result<Overrides, ShellError> {
        let (Some(bytes), Some(buf)) = (in_bytes(value), out_buffer(value)) else {
            return Err(unknown_js_value(value));
        };
        let dup_out = flags & rf::DUPLICATE_OUT != 0;
        let mut o = Overrides::default();
        if flags & rf::STDIN != 0 {
            o.stdin = Some(InOverride::Bytes(bytes));
        }
        if dup_out || flags & rf::STDOUT != 0 {
            o.stdout = Some(OutOverride::Buffer(buf.clone()));
        }
        if dup_out || flags & rf::STDERR != 0 {
            o.stderr = Some(OutOverride::Buffer(buf));
        }
        Ok(o)
    }

    async fn run_external(
        &self,
        args: Vec<String>,
        node: &Cmd,
        redirect_file: Option<String>,
        shell: &ShellExecEnv,
        io: &ShellIO,
    ) -> ExecResult {
        let env = shell.child_env();
        let Some(resolved) = which(path_env(&env), &shell.cwd, &args[0]) else {
            let msg = format!("bun: command not found: {}\n", args[0]);
            return self.cmd_write_failing_error(io, shell, &msg).await;
        };
        if cfg!(windows) && is_batch_file(&resolved) {
            if let Some(unsafe_arg) = args[1..].iter().find(|a| has_cmd_exe_special(a)) {
                let msg = format!(
                    "bun: refusing to pass argument with cmd.exe special characters to a batch file: {unsafe_arg}\n"
                );
                return self.cmd_write_failing_error(io, shell, &msg).await;
            }
        }
        let mut argv = args;
        argv[0] = resolved;
        let flags = node.redirect.bits();
        let mut overrides = Overrides::default();
        let mut dup = None;
        match &node.redirect_file {
            Some(Redirect::Atom(_)) => {
                let file = redirect_file.unwrap_or_default();
                if file.is_empty() {
                    let msg = format!("bun: ambiguous redirect: at `{}`\n", argv[0]);
                    return self.cmd_write_failing_error(io, shell, &msg).await;
                }
                match open_redirect_file(&shell.cwd, &file, flags) {
                    Ok(fd) => overrides = redirect_overrides_for_file(flags, fd),
                    Err(e) => {
                        let msg = format!("bun: {}: {file}", e.message());
                        return self.cmd_write_failing_error(io, shell, &msg).await;
                    }
                }
            }
            Some(Redirect::JsBuf(idx)) => {
                overrides = self.subproc_js_redirect(self.jsobj(*idx)?, flags)?;
            }
            None if flags & rf::DUPLICATE_OUT != 0 => {
                if flags & rf::STDOUT != 0 {
                    dup = Some(Dup::StderrToStdout);
                } else if flags & rf::STDERR != 0 {
                    dup = Some(Dup::StdoutToStderr);
                }
            }
            None => {}
        }
        let result = run_subprocess(SubprocessOptions {
            args: argv,
            cwd: &shell.cwd,
            env,
            io,
            flags,
            overrides,
            dup,
            buffered_stdout: shell.buffered_stdout.clone(),
            buffered_stderr: shell.buffered_stderr.clone(),
        })
        .await;
        match result {
            SubprocessResult::Exited(code) => Ok(code),
            SubprocessResult::SpawnError(e) => {
                let msg = format!("{}\n", e.display());
                self.cmd_write_failing_error(io, shell, &msg).await
            }
        }
    }
}
