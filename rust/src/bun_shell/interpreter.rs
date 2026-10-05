//! The Bun Shell interpreter: Bun's `interpreter.rs` and its state machines
//! (`src/runtime/shell/states/`: Script, Stmt, Binary, Pipeline, Subshell,
//! If, CondExpr, Assigns, Cmd; MIT, Copyright (c) Oven-sh / Jarred Sumner),
//! ported by way of `js/src/bun-shell/interpreter.mjs`. Each state becomes an
//! async method that resolves to the node's exit code.
//!
//! Errors that Bun throws into JS (a failed write of an error message, an
//! invalid JS redirect target) reject the whole run: they are the `Err` of
//! [`ExecResult`]. Everything else is reported on stderr with an exit code.
//!
//! Builtins borrow the [`ShellExecEnv`] mutably, so the futures are not
//! `'static`: pipeline items are driven concurrently on the caller's task
//! (see [`join_all`]) instead of being spawned.

use std::future::Future;
use std::pin::Pin;
use std::task::Poll;

use super::env::{EnvKind, EnvMap, ShellExecEnv};
use super::expansion::{expand_atom, ExpandError, ExpandOpts, Expanded};
use super::io::{Channel, InKind, OutKind, Reader, ShellIO, ShellSysError, Writer};
use super::parser::{Atom, Binary, BinaryOp, CondExpr, CondExprOp, Expr, If, Script, Stmt};
use super::{ShellError, ShellValue};

mod cmd;

/// A boxed, sendable future (breaks the async recursion).
pub(crate) type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// An exit code, or the error that rejects the run.
pub(crate) type ExecResult = Result<i32, ShellError>;

/// How to set up an [`Interpreter`] (the JS constructor options).
pub(crate) struct InterpreterOptions {
    /// JS values referenced by the script (`\x08__bun_N\x08`).
    pub(crate) jsobjs: Vec<ShellValue>,
    /// The export environment.
    pub(crate) env: EnvMap,
    /// Initial directory (default: the process cwd).
    pub(crate) cwd: Option<String>,
    /// Buffer stdout/stderr instead of echoing them.
    pub(crate) quiet: bool,
    /// Positional parameters (`$0..$9`).
    pub(crate) argv: Vec<String>,
}

/// The result of a finished script.
#[derive(Debug)]
pub(crate) struct RunOutput {
    pub(crate) exit_code: i32,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

/// The shared, read-only part of a running script.
pub(crate) struct Interpreter {
    pub(crate) jsobjs: Vec<ShellValue>,
    pub(crate) argv: Vec<String>,
    root_io: ShellIO,
}

/// Poll every future until all are done (`Promise.all` without the early
/// rejection); results keep the input order.
pub(crate) async fn join_all<'a, T: Send + 'a>(futs: Vec<BoxFut<'a, T>>) -> Vec<T> {
    let mut futs: Vec<Option<BoxFut<'a, T>>> = futs.into_iter().map(Some).collect();
    let mut results: Vec<Option<T>> = futs.iter().map(|_| None).collect();
    std::future::poll_fn(|cx| {
        let mut pending = false;
        for (slot, result) in futs.iter_mut().zip(results.iter_mut()) {
            if let Some(f) = slot {
                match f.as_mut().poll(cx) {
                    Poll::Ready(v) => {
                        *result = Some(v);
                        *slot = None;
                    }
                    Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    })
    .await;
    results.into_iter().flatten().collect()
}

impl Interpreter {
    /// Create the interpreter and its root environment. Fails like the JS
    /// constructor when the cwd cannot be entered.
    pub(crate) fn new(opts: InterpreterOptions) -> Result<(Self, ShellExecEnv), ShellError> {
        let process_cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut root = ShellExecEnv::new(opts.env, process_cwd);
        if let Some(cwd) = &opts.cwd {
            root.change_cwd(cwd, true)
                .map_err(|e| ShellError::system(e.message()))?;
        }
        let out = |writer: fn() -> Writer, captured| {
            if opts.quiet {
                OutKind::Pipe
            } else {
                OutKind::fd(writer(), Some(captured))
            }
        };
        let root_io = ShellIO {
            stdin: InKind::Fd(Reader::stdin()),
            stdout: out(Writer::stdout, root.buffered_stdout.clone()),
            stderr: out(Writer::stderr, root.buffered_stderr.clone()),
        };
        Ok((
            Self {
                jsobjs: opts.jsobjs,
                argv: opts.argv,
                root_io,
            },
            root,
        ))
    }

    /// Run a parsed script in the root environment.
    pub(crate) async fn run(
        &self,
        script: &Script,
        root: &mut ShellExecEnv,
    ) -> Result<RunOutput, ShellError> {
        let io = self.root_io.clone();
        let exit_code = self.script(script, root, &io).await?;
        Ok(RunOutput {
            exit_code,
            stdout: root.buffered_stdout.to_vec(),
            stderr: root.buffered_stderr.to_vec(),
        })
    }

    // --- control flow ------------------------------------------------------

    pub(crate) async fn script(
        &self,
        node: &Script,
        shell: &mut ShellExecEnv,
        io: &ShellIO,
    ) -> ExecResult {
        self.stmts(&node.stmts, shell, io).await
    }

    async fn stmts(&self, stmts: &[Stmt], shell: &mut ShellExecEnv, io: &ShellIO) -> ExecResult {
        let mut exit_code = 0;
        for stmt in stmts {
            exit_code = 0;
            for expr in &stmt.exprs {
                exit_code = self.expr(expr, shell, io).await?;
            }
        }
        Ok(exit_code)
    }

    fn expr<'a>(
        &'a self,
        node: &'a Expr,
        shell: &'a mut ShellExecEnv,
        io: &'a ShellIO,
    ) -> BoxFut<'a, ExecResult> {
        Box::pin(async move {
            match node {
                Expr::Assign(assigns) => self.assigns(assigns, shell, false).await,
                Expr::Binary(b) => self.binary(b, shell, io).await,
                Expr::Pipeline(items) => self.pipeline(items, shell, io).await,
                Expr::Cmd(c) => self.cmd(c, shell, io).await,
                Expr::Subshell(s) => {
                    let mut env = shell.dupe_for_subshell(io, EnvKind::Subshell);
                    self.script(&s.script, &mut env, io).await
                }
                Expr::If(node) => self.if_clause(node, shell, io).await,
                Expr::CondExpr(node) => self.cond_expr(node, shell, io).await,
            }
        })
    }

    async fn binary(&self, node: &Binary, shell: &mut ShellExecEnv, io: &ShellIO) -> ExecResult {
        let left = self.expr(&node.left, shell, io).await?;
        if (node.op == BinaryOp::And && left != 0) || (node.op == BinaryOp::Or && left == 0) {
            return Ok(left);
        }
        self.expr(&node.right, shell, io).await
    }

    async fn pipeline(&self, items: &[Expr], shell: &ShellExecEnv, io: &ShellIO) -> ExecResult {
        let items: Vec<&Expr> = items
            .iter()
            .filter(|item| !matches!(item, Expr::Assign(_)))
            .collect();
        if items.is_empty() {
            return Ok(0);
        }
        let n = items.len();
        let channels: Vec<Channel> = (1..n).map(|_| Channel::new()).collect();
        let mut runs: Vec<BoxFut<'_, ExecResult>> = Vec::with_capacity(n);
        for (i, item) in items.into_iter().enumerate() {
            let stdin = if i == 0 {
                io.stdin.clone()
            } else {
                InKind::Fd(Reader::channel(channels[i - 1].clone()))
            };
            let stdout = if i == n - 1 {
                io.stdout.clone()
            } else {
                OutKind::fd(Writer::channel(channels[i].clone()), None)
            };
            let item_io = ShellIO {
                stdin,
                stdout,
                stderr: io.stderr.clone(),
            };
            let mut env = shell.dupe_for_subshell(&item_io, EnvKind::Pipeline);
            runs.push(Box::pin(async move {
                let result = self.expr(item, &mut env, &item_io).await;
                if i > 0 {
                    if let InKind::Fd(reader) = &item_io.stdin {
                        reader.close();
                    }
                }
                if i < n - 1 {
                    if let OutKind::Fd { writer, .. } = &item_io.stdout {
                        writer.close().await;
                    }
                }
                result
            }));
        }
        drop(channels);
        let mut last = 0;
        for code in join_all(runs).await {
            last = code?;
        }
        Ok(if n >= 2 { last } else { 0 })
    }

    async fn if_clause(&self, node: &If, shell: &mut ShellExecEnv, io: &ShellIO) -> ExecResult {
        if self.stmts(&node.cond, shell, io).await? == 0 {
            return self.stmts(&node.then, shell, io).await;
        }
        let parts = &node.else_parts;
        match parts.len() {
            0 => return Ok(0),
            1 => return self.stmts(&parts[0], shell, io).await,
            _ => {}
        }
        let mut i = 0;
        while i + 1 < parts.len() {
            if self.stmts(&parts[i], shell, io).await? == 0 {
                return self.stmts(&parts[i + 1], shell, io).await;
            }
            i += 2;
        }
        if i < parts.len() {
            self.stmts(&parts[i], shell, io).await
        } else {
            Ok(0)
        }
    }

    async fn cond_expr(&self, node: &CondExpr, shell: &ShellExecEnv, io: &ShellIO) -> ExecResult {
        let mut args = Vec::with_capacity(node.args.len());
        for atom in &node.args {
            match self.expand(atom, shell, ExpandOpts::default()).await {
                Ok(out) => args.push(out.buf),
                Err(e) => {
                    let msg = format!("{}\n", e.display()?);
                    return Ok(self.write_failing_error_no_throw(io, shell, &msg).await);
                }
            }
        }
        let first = args.first().map(String::as_str).unwrap_or("");
        Ok(match node.op {
            CondExprOp::IsFile | CondExprOp::IsDirectory | CondExprOp::IsCharDevice => {
                if first.is_empty() {
                    return Ok(1);
                }
                let Ok(st) = std::fs::metadata(shell.resolve(first)) else {
                    return Ok(1);
                };
                let ok = match node.op {
                    CondExprOp::IsFile => st.is_file(),
                    CondExprOp::IsDirectory => st.is_dir(),
                    _ => is_char_device(&st),
                };
                i32::from(!ok)
            }
            CondExprOp::IsEmpty => i32::from(!first.is_empty()),
            CondExprOp::IsNonEmpty => i32::from(first.is_empty()),
            CondExprOp::Eq => {
                i32::from(!(args.is_empty() || (args.len() >= 2 && args[0] == args[1])))
            }
            CondExprOp::NotEq => i32::from(!(args.len() >= 2 && args[0] != args[1])),
        })
    }

    // --- expansion ----------------------------------------------------------

    pub(crate) async fn expand(
        &self,
        atom: &Atom,
        shell: &ShellExecEnv,
        opts: ExpandOpts,
    ) -> Result<Expanded, ExpandError> {
        expand_atom(self, shell, atom, opts).await
    }

    /// `$(...)`: run in a child env whose stdout is buffered; resolves to the
    /// exit code and the (lossily decoded) output.
    pub(crate) fn cmd_subst<'a>(
        &'a self,
        script: &'a Script,
        shell: &'a ShellExecEnv,
    ) -> BoxFut<'a, Result<(i32, String), ShellError>> {
        Box::pin(async move {
            let io = ShellIO {
                stdin: self.root_io.stdin.clone(),
                stdout: OutKind::Pipe,
                stderr: self.root_io.stderr.clone(),
            };
            let mut env = shell.dupe_for_subshell(&io, EnvKind::CmdSubst);
            let exit_code = self.script(script, &mut env, &io).await?;
            let stdout = String::from_utf8_lossy(&env.buffered_stdout.to_vec()).into_owned();
            Ok((exit_code, stdout))
        })
    }

    /// Assignments (Bun's `Assigns` state): 0, or 1 on an expansion error
    /// (Bun reports nothing here).
    pub(crate) async fn assigns(
        &self,
        assigns: &[super::parser::Assign],
        shell: &mut ShellExecEnv,
        cmd_local: bool,
    ) -> ExecResult {
        for assign in assigns {
            let opts = ExpandOpts {
                is_assign: true,
                assign_ctx: true,
            };
            let out = match self.expand(&assign.value, shell, opts).await {
                Ok(out) => out,
                Err(e) => {
                    e.display()?;
                    return Ok(1);
                }
            };
            shell.assign_var(&assign.label, out.words().join(" "), cmd_local);
        }
        Ok(0)
    }

    // --- errors -----------------------------------------------------------

    /// Bun's `Cmd` write_failing_error: a failed write rejects the run.
    pub(crate) async fn cmd_write_failing_error(
        &self,
        io: &ShellIO,
        shell: &ShellExecEnv,
        msg: &str,
    ) -> ExecResult {
        match write_err(io, shell, msg).await {
            Ok(()) => Ok(1),
            Err(e) => Err(ShellError::system(e.message())),
        }
    }

    /// The CondExpr/Assigns flavour: a failed write becomes the exit code.
    async fn write_failing_error_no_throw(
        &self,
        io: &ShellIO,
        shell: &ShellExecEnv,
        msg: &str,
    ) -> i32 {
        match write_err(io, shell, msg).await {
            Ok(()) => 1,
            Err(e) => e.errno,
        }
    }
}

async fn write_err(io: &ShellIO, shell: &ShellExecEnv, msg: &str) -> Result<(), ShellSysError> {
    io.stderr
        .write(msg.as_bytes(), &shell.buffered_stderr)
        .await
}

#[cfg(unix)]
fn is_char_device(st: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    st.file_type().is_char_device()
}

#[cfg(not(unix))]
fn is_char_device(_st: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests;
