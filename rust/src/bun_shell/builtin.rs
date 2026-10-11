//! The builtin command framework: Bun's `Builtin` (`src/runtime/shell/
//! Builtin.rs`; MIT, Copyright (c) Oven-sh / Jarred Sumner), ported by way of
//! `js/src/bun-shell/builtin.mjs`.
//!
//! A builtin is an `async fn(&mut Builtin<'_>) -> i32` (see
//! [`super::builtins`]). The [`Builtin`] carries the command's kind, its
//! arguments after argv\[0\], the mutable [`ShellExecEnv`] and its
//! stdin/stdout/stderr:
//!
//! - output that "needs IO" ([`BuiltinOut::Fd`]) goes through a [`Writer`]
//!   and may fail asynchronously;
//! - other outputs are written synchronously ([`Builtin::write_no_io`]):
//!   `Buf` appends to the shell's buffered stdout/stderr, `ArrayBuf` fills a
//!   JS-style fixed buffer and fails with ENOSPC once full, `Blob`/`Ignore`
//!   discard.

// Parts of the framework (flag parsing, the Blob/Ignore outputs, the
// ArrayBuf helpers) serve the ls/rm/mkdir/touch/mv/cat/cp builtins, which are
// not ported yet.
#![allow(dead_code)]

use std::fs::{File, OpenOptions};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use super::env::ShellExecEnv;
use super::errno::errno_message;
use super::io::{redirect_flags, InKind, OutKind, Reader, SharedBuf, ShellSysError, Which, Writer};
use super::node_path;
use super::OutBuffer;

/// Bun's builtin `Kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum BuiltinKind {
    Cat,
    Touch,
    Mkdir,
    Export,
    Cd,
    Echo,
    Pwd,
    Which,
    Rm,
    Mv,
    Ls,
    Exit,
    True,
    False,
    Yes,
    Seq,
    Dirname,
    Basename,
    Cp,
}

impl BuiltinKind {
    pub(crate) const ALL: [BuiltinKind; 19] = [
        BuiltinKind::Cat,
        BuiltinKind::Touch,
        BuiltinKind::Mkdir,
        BuiltinKind::Export,
        BuiltinKind::Cd,
        BuiltinKind::Echo,
        BuiltinKind::Pwd,
        BuiltinKind::Which,
        BuiltinKind::Rm,
        BuiltinKind::Mv,
        BuiltinKind::Ls,
        BuiltinKind::Exit,
        BuiltinKind::True,
        BuiltinKind::False,
        BuiltinKind::Yes,
        BuiltinKind::Seq,
        BuiltinKind::Dirname,
        BuiltinKind::Basename,
        BuiltinKind::Cp,
    ];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            BuiltinKind::Cat => "cat",
            BuiltinKind::Touch => "touch",
            BuiltinKind::Mkdir => "mkdir",
            BuiltinKind::Export => "export",
            BuiltinKind::Cd => "cd",
            BuiltinKind::Echo => "echo",
            BuiltinKind::Pwd => "pwd",
            BuiltinKind::Which => "which",
            BuiltinKind::Rm => "rm",
            BuiltinKind::Mv => "mv",
            BuiltinKind::Ls => "ls",
            BuiltinKind::Exit => "exit",
            BuiltinKind::True => "true",
            BuiltinKind::False => "false",
            BuiltinKind::Yes => "yes",
            BuiltinKind::Seq => "seq",
            BuiltinKind::Dirname => "dirname",
            BuiltinKind::Basename => "basename",
            BuiltinKind::Cp => "cp",
        }
    }

    /// Bun's `Kind::from_argv0`: the builtin for a command name. `cat` and
    /// `cp` are disabled outside Windows unless
    /// `BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS` is `1` or `true`.
    pub(crate) fn from_argv0(argv0: &str) -> Option<Self> {
        let kind = Self::ALL.into_iter().find(|k| k.as_str() == argv0)?;
        if !cfg!(windows)
            && matches!(kind, BuiltinKind::Cat | BuiltinKind::Cp)
            && !experimental_builtins_enabled()
        {
            return None;
        }
        Some(kind)
    }

    /// The usage message (`""` for builtins without one).
    pub(crate) fn usage(self) -> &'static str {
        match self {
            BuiltinKind::Exit => "usage: exit [n]\n",
            BuiltinKind::Basename => "usage: basename string\n",
            BuiltinKind::Dirname => "usage: dirname string\n",
            BuiltinKind::Cat => "usage: cat [-belnstuv] [file ...]\n",
            BuiltinKind::Mv => "usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n",
            BuiltinKind::Rm => "usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n",
            BuiltinKind::Ls => "usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]\n",
            BuiltinKind::Mkdir => "usage: mkdir [-pv] [-m mode] directory_name ...\n",
            BuiltinKind::Touch => "usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n",
            BuiltinKind::Cp => "usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n",
            BuiltinKind::Seq => "usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n",
            BuiltinKind::Yes => "usage: yes [expletive]\n",
            _ => "",
        }
    }
}

fn experimental_builtins_enabled() -> bool {
    matches!(
        std::env::var("BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS").as_deref(),
        Ok("1") | Ok("true")
    )
}

/// A builtin's stdout/stderr (Bun's `BuiltinIO::Output`).
#[derive(Clone, Debug)]
pub(crate) enum BuiltinOut {
    /// Through a writer (a file, pipe or the process stream); `captured`
    /// receives a copy of what was written.
    Fd {
        writer: Writer,
        captured: Option<SharedBuf>,
    },
    /// Append to the shell env's buffered stdout or stderr.
    Buf(Which),
    /// `> ${buf}`: fill the buffer from `pos`; ENOSPC once full. `pos` is
    /// shared by clones (`2>&1` makes stderr the same output as stdout).
    ArrayBuf {
        buf: OutBuffer,
        pos: Arc<AtomicUsize>,
    },
    /// `> ${blob}`: discarded.
    Blob,
    Ignore,
}

impl BuiltinOut {
    /// A fresh `> ${buf}` output starting at offset 0.
    pub(crate) fn array_buf(buf: OutBuffer) -> Self {
        BuiltinOut::ArrayBuf {
            buf,
            pos: Arc::new(AtomicUsize::new(0)),
        }
    }
}

/// A builtin's stdin (Bun's `BuiltinIO::Input`).
#[derive(Clone, Debug)]
pub(crate) enum BuiltinIn {
    Fd(Reader),
    /// `< ${buf}`.
    ArrayBuf(Vec<u8>),
    /// `< ${blob}` / `< ${response}`.
    Blob(Vec<u8>),
    Ignore,
}

/// Bun's `BuiltinIO::from_out_kind`.
pub(crate) fn builtin_out_from_cmd_out(out: &OutKind, which: Which) -> BuiltinOut {
    match out {
        OutKind::Fd { writer, captured } => BuiltinOut::Fd {
            writer: writer.clone(),
            captured: captured.clone(),
        },
        OutKind::Pipe => BuiltinOut::Buf(which),
        OutKind::Ignore => BuiltinOut::Ignore,
    }
}

pub(crate) fn builtin_in_from_cmd_in(input: &InKind) -> BuiltinIn {
    match input {
        InKind::Fd(reader) => BuiltinIn::Fd(reader.clone()),
        InKind::Ignore => BuiltinIn::Ignore,
    }
}

/// Why option parsing failed (Bun's `ParseError`, passed to `fail_parse`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ParseError {
    /// `{kind}: illegal option -- {opt}`.
    Illegal(String),
    /// `{kind}: unsupported option, please open a GitHub issue -- {opt}`.
    Unsupported(String),
    /// The builtin's usage message.
    Usage,
}

/// A running builtin command.
pub(crate) struct Builtin<'a> {
    pub(crate) kind: BuiltinKind,
    /// Arguments after argv\[0\].
    pub(crate) args: Vec<String>,
    pub(crate) shell: &'a mut ShellExecEnv,
    pub(crate) stdin: BuiltinIn,
    pub(crate) stdout: BuiltinOut,
    pub(crate) stderr: BuiltinOut,
}

impl<'a> Builtin<'a> {
    /// A builtin wired to the command's IO (redirects are applied by the
    /// caller by replacing `stdin`/`stdout`/`stderr`).
    pub(crate) fn new(
        kind: BuiltinKind,
        args: Vec<String>,
        shell: &'a mut ShellExecEnv,
        io: &super::io::ShellIO,
    ) -> Self {
        Self {
            kind,
            args,
            shell,
            stdin: builtin_in_from_cmd_in(&io.stdin),
            stdout: builtin_out_from_cmd_out(&io.stdout, Which::Stdout),
            stderr: builtin_out_from_cmd_out(&io.stderr, Which::Stderr),
        }
    }

    pub(crate) fn cwd(&self) -> &str {
        &self.shell.cwd
    }

    pub(crate) fn out(&self, which: Which) -> &BuiltinOut {
        match which {
            Which::Stdout => &self.stdout,
            Which::Stderr => &self.stderr,
        }
    }

    pub(crate) fn out_mut(&mut self, which: Which) -> &mut BuiltinOut {
        match which {
            Which::Stdout => &mut self.stdout,
            Which::Stderr => &mut self.stderr,
        }
    }

    /// Whether `which` is an fd that needs async IO.
    pub(crate) fn needs_io(&self, which: Which) -> bool {
        matches!(self.out(which), BuiltinOut::Fd { .. })
    }

    pub(crate) fn stdin_needs_io(&self) -> bool {
        matches!(self.stdin, BuiltinIn::Fd(_))
    }

    /// Synchronous write to a non-fd output: the number of bytes taken, or
    /// ENOSPC for a full `ArrayBuf`. Must not be called for an `Fd` output.
    pub(crate) fn write_no_io(
        &mut self,
        which: Which,
        data: &[u8],
    ) -> Result<usize, ShellSysError> {
        debug_assert!(!self.needs_io(which), "write_no_io called on an fd output");
        if data.is_empty() {
            return Ok(0);
        }
        match self.out(which) {
            BuiltinOut::Buf(target) => {
                match target {
                    Which::Stdout => self.shell.buffered_stdout.append(data),
                    Which::Stderr => self.shell.buffered_stderr.append(data),
                }
                Ok(data.len())
            }
            BuiltinOut::ArrayBuf { buf, pos } => buf.with(|view| {
                let total = view.len();
                let at = pos.load(Ordering::SeqCst);
                if at >= total {
                    return Err(ShellSysError::new("ENOSPC").with_syscall("write"));
                }
                let n = (total - at).min(data.len());
                view[at..at + n].copy_from_slice(&data[..n]);
                pos.store(at + n, Ordering::SeqCst);
                Ok(n)
            }),
            _ => Ok(data.len()),
        }
    }

    /// Write to `which`: through the writer for fds, synchronously otherwise.
    pub(crate) async fn write(
        &mut self,
        which: Which,
        data: impl AsRef<[u8]>,
    ) -> Result<(), ShellSysError> {
        let data = data.as_ref();
        if let BuiltinOut::Fd { writer, captured } = self.out(which) {
            let (writer, captured) = (writer.clone(), captured.clone());
            return writer.write(data, captured.as_ref()).await;
        }
        self.write_no_io(which, data).map(|_| ())
    }

    /// Stdin bytes of a buffer/blob input (empty for fds and ignore).
    pub(crate) fn read_stdin_no_io(&self) -> Vec<u8> {
        match &self.stdin {
            BuiltinIn::ArrayBuf(b) | BuiltinIn::Blob(b) => b.clone(),
            _ => Vec::new(),
        }
    }

    /// `{kind}: {msg}` (Bun's `fmt_error_arena` with a kind).
    pub(crate) fn fmt_err(&self, msg: &str) -> String {
        format!("{}: {msg}", self.kind.as_str())
    }

    /// Bun's `shell_err_to_string`: `{kind}: {message}: {path}\n`.
    pub(crate) fn shell_err_to_string(&self, err: &ShellSysError) -> String {
        if err.path.is_empty() {
            self.fmt_err(&format!("{}\n", err.message()))
        } else {
            self.fmt_err(&format!("{}: {}\n", err.message(), err.path))
        }
    }

    /// Bun's `task_error_to_string`: `{kind}: {path}: {message}\n`.
    pub(crate) fn task_error_to_string(&self, err: &ShellSysError) -> String {
        match errno_message(err.code) {
            Some(message) if err.path.is_empty() => self.fmt_err(&format!("{message}\n")),
            Some(message) => self.fmt_err(&format!("{}: {message}\n", err.path)),
            None => self.fmt_err(&format!("unknown error {}\n", err.errno.abs())),
        }
    }

    /// Write `msg` to stderr and finish with `exit_code`.
    pub(crate) async fn write_failing_error(
        &mut self,
        msg: impl AsRef<[u8]>,
        exit_code: i32,
    ) -> i32 {
        let _ = self.write(Which::Stderr, msg).await;
        exit_code
    }

    /// Bun's `fail_parse`: report an option error and exit with 1.
    pub(crate) async fn fail_parse(&mut self, err: ParseError) -> i32 {
        let msg = match err {
            ParseError::Illegal(opt) => self.fmt_err(&format!("illegal option -- {opt}\n")),
            ParseError::Unsupported(opt) => self.fmt_err(&format!(
                "unsupported option, please open a GitHub issue -- {opt}\n"
            )),
            ParseError::Usage => self.kind.usage().to_string(),
        };
        self.write_failing_error(msg, 1).await
    }
}

/// `OpenOptions` for a redirect (Bun's `RedirectFlags::to_flags`): read-only
/// for `<`, otherwise write + create + append/truncate, mode 0666.
pub(crate) fn redirect_open_options(flags: u8) -> OpenOptions {
    let mut o = OpenOptions::new();
    if flags & redirect_flags::STDIN != 0 {
        o.read(true);
    } else {
        o.write(true).create(true);
        if flags & redirect_flags::APPEND != 0 {
            o.append(true);
        } else {
            o.truncate(true);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o666);
        }
    }
    o
}

/// Open a redirect target relative to the shell cwd (`/dev/null` is `NUL`
/// on Windows). Errors keep `file` as their path.
pub(crate) fn open_redirect_file(cwd: &str, file: &str, flags: u8) -> Result<File, ShellSysError> {
    let target = if cfg!(windows) && file == "/dev/null" {
        "NUL"
    } else {
        file
    };
    redirect_open_options(flags)
        .open(node_path::resolve(&[cwd, target]))
        .map_err(|e| ShellSysError::from_io(&e, file).with_syscall("open"))
}

/// Bun's `bun_sys::is_executable_file_path`.
pub(crate) fn is_executable_file(p: &str) -> bool {
    match std::fs::metadata(p) {
        Ok(m) if m.is_file() => {}
        _ => return false,
    }
    #[cfg(unix)]
    {
        nix::unistd::access(p, nix::unistd::AccessFlags::X_OK).is_ok()
    }
    #[cfg(not(unix))]
    {
        true
    }
}

const WIN_EXTENSIONS: [&str; 4] = ["exe", "cmd", "bat", "com"];

/// The Windows half of [`which`].
pub(crate) fn which_windows(path_env: &str, cwd: &str, bin: &str) -> Option<String> {
    if bin.is_empty() {
        return None;
    }
    let lower = bin.to_lowercase();
    let has_ext = WIN_EXTENSIONS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")));
    let candidates = |base: String| -> Vec<String> {
        let mut v = vec![base.clone()];
        if !has_ext {
            v.extend(WIN_EXTENSIONS.iter().map(|e| format!("{base}.{e}")));
        }
        v
    };
    if bin.contains(['\\', '/']) || node_path::win32::is_absolute(bin) {
        return candidates(node_path::win32::resolve(&[cwd, bin]))
            .into_iter()
            .find(|c| is_executable_file(c));
    }
    let mut dirs = Vec::new();
    if !cwd.is_empty() {
        dirs.push(cwd.to_string());
    }
    for seg in path_env.split(';').filter(|s| !s.is_empty()) {
        dirs.push(node_path::win32::resolve(&[cwd, seg]));
    }
    dirs.iter().find_map(|dir| {
        candidates(node_path::win32::join(&[dir, bin]))
            .into_iter()
            .find(|c| is_executable_file(c))
    })
}

fn join_with_sep(prefix: &str, part: &str) -> String {
    if prefix.is_empty() {
        part.to_string()
    } else if prefix.ends_with('/') {
        format!("{prefix}{part}")
    } else {
        format!("{prefix}/{part}")
    }
}

/// The POSIX half of [`which`].
pub(crate) fn which_posix(path_env: &str, cwd: &str, bin: &str) -> Option<String> {
    let len = bin.encode_utf16().count();
    if len == 0 || len >= 4096 {
        return None;
    }
    if node_path::posix::is_absolute(bin) {
        return is_executable_file(bin).then(|| bin.to_string());
    }
    let mut cwd_trimmed = cwd;
    while cwd_trimmed.len() > 1 && cwd_trimmed.ends_with('/') {
        cwd_trimmed = &cwd_trimmed[..cwd_trimmed.len() - 1];
    }
    if bin.contains('/') {
        if cwd.is_empty() {
            return None;
        }
        let rel = bin.strip_prefix("./").unwrap_or(bin);
        let p = join_with_sep(cwd_trimmed, rel);
        return is_executable_file(&p).then_some(p);
    }
    let cwd_for_relative = if node_path::posix::is_absolute(cwd) {
        cwd_trimmed
    } else {
        ""
    };
    path_env
        .split(':')
        .filter(|s| !s.is_empty())
        .find_map(|segment| {
            let prefix = if node_path::posix::is_absolute(segment) {
                segment.to_string()
            } else {
                join_with_sep(cwd_for_relative, segment)
            };
            let p = join_with_sep(&prefix, bin);
            is_executable_file(&p).then_some(p)
        })
}

/// Bun's `which(path, cwd, bin)`: resolve a command name the way the shell
/// does (absolute paths as-is, names with a `/` relative to the cwd without
/// normalization, other names through `PATH`; `PATHEXT`-style extensions on
/// Windows).
pub(crate) fn which(path_env: &str, cwd: &str, bin: &str) -> Option<String> {
    if cfg!(windows) {
        which_windows(path_env, cwd, bin)
    } else {
        which_posix(path_env, cwd, bin)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bun_shell::env::EnvMap;

    #[test]
    fn kinds() {
        assert_eq!(BuiltinKind::from_argv0("echo"), Some(BuiltinKind::Echo));
        assert_eq!(BuiltinKind::from_argv0("nope"), None);
        assert_eq!(BuiltinKind::from_argv0("ls"), Some(BuiltinKind::Ls));
        for k in BuiltinKind::ALL {
            assert_eq!(
                BuiltinKind::ALL
                    .iter()
                    .filter(|x| x.as_str() == k.as_str())
                    .count(),
                1
            );
        }
        assert_eq!(BuiltinKind::Exit.usage(), "usage: exit [n]\n");
        assert_eq!(BuiltinKind::Echo.usage(), "");
    }

    #[tokio::test]
    async fn write_no_io_and_errors() {
        let mut shell = ShellExecEnv::new(EnvMap::new(), "/");
        let buf = OutBuffer::new(4);
        let mut b = Builtin {
            kind: BuiltinKind::Ls,
            args: vec![],
            shell: &mut shell,
            stdin: BuiltinIn::ArrayBuf(b"in".to_vec()),
            stdout: BuiltinOut::array_buf(buf.clone()),
            stderr: BuiltinOut::Buf(Which::Stderr),
        };
        assert_eq!(b.write_no_io(Which::Stdout, b"abc"), Ok(3));
        assert_eq!(b.write_no_io(Which::Stdout, b"de"), Ok(1));
        let e = b.write_no_io(Which::Stdout, b"f").unwrap_err();
        assert_eq!((e.code, e.syscall), ("ENOSPC", "write"));
        assert_eq!(b.write_no_io(Which::Stdout, b""), Ok(0));
        assert_eq!(buf.contents(), b"abcd");
        assert_eq!(b.read_stdin_no_io(), b"in");
        assert!(!b.needs_io(Which::Stdout));

        let err = ShellSysError::new("ENOENT").with_path("x");
        assert_eq!(
            b.shell_err_to_string(&err),
            "ls: No such file or directory: x\n"
        );
        assert_eq!(
            b.task_error_to_string(&err),
            "ls: x: No such file or directory\n"
        );
        let bare = ShellSysError::new("EACCES");
        assert_eq!(b.shell_err_to_string(&bare), "ls: Permission denied\n");
        assert_eq!(b.task_error_to_string(&bare), "ls: Permission denied\n");
        let mut unknown = ShellSysError::new("EWHAT");
        unknown.errno = -7;
        assert_eq!(b.task_error_to_string(&unknown), "ls: unknown error 7\n");

        assert_eq!(b.fail_parse(ParseError::Illegal("Z".into())).await, 1);
        assert_eq!(b.fail_parse(ParseError::Unsupported("x".into())).await, 1);
        assert_eq!(b.fail_parse(ParseError::Usage).await, 1);
        assert_eq!(
            String::from_utf8(shell.buffered_stderr.to_vec()).unwrap(),
            format!(
                "ls: illegal option -- Z\nls: unsupported option, please open a GitHub issue -- x\n{}",
                BuiltinKind::Ls.usage()
            )
        );
    }

    #[test]
    fn redirect_files() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().into_owned();
        use std::io::{Read, Write};
        let mut f = open_redirect_file(&cwd, "out", redirect_flags::STDOUT).unwrap();
        f.write_all(b"one").unwrap();
        drop(f);
        let mut f =
            open_redirect_file(&cwd, "out", redirect_flags::STDOUT | redirect_flags::APPEND)
                .unwrap();
        f.write_all(b"two").unwrap();
        drop(f);
        let mut s = String::new();
        open_redirect_file(&cwd, "out", redirect_flags::STDIN)
            .unwrap()
            .read_to_string(&mut s)
            .unwrap();
        assert_eq!(s, "onetwo");
        let e = open_redirect_file(&cwd, "missing", redirect_flags::STDIN).unwrap_err();
        assert_eq!((e.code, e.path.as_str()), ("ENOENT", "missing"));
        assert!(open_redirect_file(&cwd, "/dev/null", redirect_flags::STDOUT).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn which_posix_lookup() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        for (p, mode) in [
            ("bin/tool", 0o755),
            ("cwd/tool", 0o755),
            ("bin/plain", 0o644),
        ] {
            let full = dir.path().join(p);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(&full, "").unwrap();
            std::fs::set_permissions(&full, std::fs::Permissions::from_mode(mode)).unwrap();
        }
        let path = format!("{root}/bin");
        let cwd = format!("{root}/cwd/");
        assert_eq!(which(&path, &cwd, "tool"), Some(format!("{root}/bin/tool")));
        assert_eq!(
            which(&path, &cwd, "./tool"),
            Some(format!("{root}/cwd/tool"))
        );
        assert_eq!(
            which(&path, &cwd, "../bin/tool"),
            Some(format!("{root}/cwd/../bin/tool"))
        );
        assert_eq!(which(&path, &cwd, "plain"), None);
        assert_eq!(which(&path, &cwd, "missing"), None);
        assert_eq!(which(&path, "", "./tool"), None);
        assert_eq!(
            which("bin", &root, "tool"),
            Some(format!("{root}/bin/tool"))
        );
        let abs = format!("{root}/bin/tool");
        assert_eq!(which("", "/", &abs), Some(abs.clone()));
        assert_eq!(which(&path, &cwd, ""), None);
        assert_eq!(which(&path, &cwd, &format!("/{}", "a".repeat(4095))), None);
        // Windows lookup rules compile and run everywhere.
        assert_eq!(which_windows(&path, &cwd, "missing"), None);
    }
}
