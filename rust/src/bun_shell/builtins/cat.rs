//! The `cat` builtin. Ported from Bun's `src/runtime/shell/builtin/cat.rs`
//! (MIT, Copyright (c) Oven-sh / Jarred Sumner) by way of
//! `js/src/bun-shell/builtins/cat.mjs`.
//!
//! With no file operands cat copies its stdin to stdout. Otherwise it opens
//! each file in turn and streams it to stdout. It stops at the first file
//! that fails to open, or the first read or write error. A write error ends
//! cat with its errno.
//!
//! Bun 1.4.2 on Linux registers every reader fd with epoll. `epoll_ctl`
//! fails with EPERM for fds that cannot be polled: regular files,
//! directories, block devices, `/dev/null` and similar. The reader then
//! fails before reading anything, and cat exits with 1 and prints nothing.
//! For example, `cat file` and `cat < file` both do this. Pipes, sockets and
//! ttys work. This port reproduces that behavior (like the JavaScript port,
//! it exits with 1 where Bun hangs because stdout is an fd).
//!
//! On Windows files are opened with `FILE_FLAG_BACKUP_SEMANTICS`, as libuv
//! (and so Node) does, so a directory opens and its read fails with EISDIR.

use std::fs::{File, OpenOptions};

use crate::bun_shell::builtin::{Builtin, BuiltinIn};
use crate::bun_shell::io::{Reader, ShellSysError, Which};
use crate::bun_shell::node_path;

/// What an unpollable reader ends cat with (EPERM from `epoll_ctl`).
const EPERM: i32 = 1;

/// The result of Bun's `parse_flags` with cat's options.
#[derive(Debug, PartialEq, Eq)]
enum Parsed {
    /// The index of the first operand; `None` when there are none (stdin).
    Start(Option<usize>),
    /// `illegal option -- {bytes}`: the bytes after the flag's first one.
    Illegal(Vec<u8>),
    /// `unsupported option ... -- {opt}`.
    Unsupported(String),
}

/// Only the first argument's first flag character is looked at: every
/// branch of Bun's loop returns.
fn parse_opts(args: &[String]) -> Parsed {
    let Some(arg) = args.first() else {
        return Parsed::Start(None);
    };
    if !arg.starts_with('-') {
        return Parsed::Start(Some(0));
    }
    if arg.len() == 1 {
        return Parsed::Illegal(b"-".to_vec());
    }
    let small = &arg.as_bytes()[1..];
    let ch = small[0];
    if b"bestuvn".contains(&ch) {
        return Parsed::Unsupported(format!("-{}", ch as char));
    }
    Parsed::Illegal(small[1..].to_vec())
}

/// Cat's `write_failing_error`: a failed stderr write ends with its errno.
async fn fail(b: &mut Builtin<'_>, msg: &[u8], exit_code: i32) -> i32 {
    if b.needs_io(Which::Stderr) {
        return match b.write(Which::Stderr, msg).await {
            Ok(()) => exit_code,
            Err(e) => e.errno,
        };
    }
    let _ = b.write_no_io(Which::Stderr, msg);
    exit_code
}

async fn fail_opts(b: &mut Builtin<'_>, parsed: Parsed) -> i32 {
    let msg = match parsed {
        Parsed::Unsupported(opt) => b
            .fmt_err(&format!(
                "unsupported option, please open a GitHub issue -- {opt}\n"
            ))
            .into_bytes(),
        Parsed::Illegal(rest) => {
            let mut msg = b.fmt_err("illegal option -- ").into_bytes();
            msg.extend_from_slice(&rest);
            msg.push(b'\n');
            msg
        }
        Parsed::Start(_) => unreachable!("fail_opts called with operands"),
    };
    fail(b, &msg, 1).await
}

/// Character devices of major 1 that do not support poll (mem, port, null,
/// zero, full). `/dev/random` and `/dev/urandom` can be polled.
#[cfg(target_os = "linux")]
const UNPOLLABLE_MEM_MINORS: [u64; 5] = [1, 3, 4, 5, 7];

/// Whether Bun's epoll registration of the reader's fd would fail (see the
/// module docs). Only file and process-stdin readers have an fd.
#[cfg(target_os = "linux")]
fn unpollable(reader: &Reader) -> bool {
    use crate::bun_shell::io::ReaderSource;
    use std::os::fd::AsFd;
    use std::os::unix::fs::{FileTypeExt, MetadataExt};

    let meta = match reader.source() {
        ReaderSource::File(f) => f.metadata(),
        ReaderSource::Stdin => std::io::stdin()
            .as_fd()
            .try_clone_to_owned()
            .and_then(|fd| File::from(fd).metadata()),
        ReaderSource::Channel(_) => return false,
    };
    let Ok(st) = meta else {
        return false;
    };
    let ft = st.file_type();
    if ft.is_file() || ft.is_dir() || ft.is_block_device() {
        return true;
    }
    if ft.is_char_device() {
        let rdev = st.rdev();
        let major = (rdev >> 8) & 0xfff;
        let minor = (rdev & 0xff) | ((rdev >> 12) & 0xffff_ff00);
        return major == 1 && UNPOLLABLE_MEM_MINORS.contains(&minor);
    }
    false
}

#[cfg(not(target_os = "linux"))]
fn unpollable(_reader: &Reader) -> bool {
    false
}

/// Stream a reader to stdout: 0, or the errno of a read or write error.
async fn pump(b: &mut Builtin<'_>, reader: &Reader) -> i32 {
    if unpollable(reader) {
        return EPERM;
    }
    let stdout_io = b.needs_io(Which::Stdout);
    loop {
        match reader.read_chunk().await {
            Ok(None) => return 0,
            Ok(Some(chunk)) => {
                if stdout_io {
                    if let Err(e) = b.write(Which::Stdout, &chunk).await {
                        return e.errno;
                    }
                } else {
                    let _ = b.write_no_io(Which::Stdout, &chunk);
                }
            }
            Err(e) => return e.errno,
        }
    }
}

async fn cat_stdin(b: &mut Builtin<'_>) -> i32 {
    if let BuiltinIn::Fd(reader) = &b.stdin {
        let reader = reader.clone();
        return pump(b, &reader).await;
    }
    let buf = b.read_stdin_no_io();
    if b.needs_io(Which::Stdout) {
        return match b.write(Which::Stdout, &buf).await {
            Ok(()) => 0,
            Err(e) => e.errno,
        };
    }
    let _ = b.write_no_io(Which::Stdout, &buf);
    0
}

/// `fs.openSync(p, O_RDONLY)`.
fn open_read(p: &str) -> std::io::Result<File> {
    let mut opts = OpenOptions::new();
    opts.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        opts.custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
    }
    opts.open(p)
}

/// The `cat` builtin.
pub(crate) async fn cat(b: &mut Builtin<'_>) -> i32 {
    let start = match parse_opts(&b.args) {
        Parsed::Start(None) => return cat_stdin(b).await,
        Parsed::Start(Some(start)) => start,
        parsed => return fail_opts(b, parsed).await,
    };
    let cwd = b.cwd().to_string();
    let operands = b.args[start..].to_vec();
    for arg in &operands {
        let opened = if arg.is_empty() {
            Err(ShellSysError::new("ENOENT").with_syscall("open"))
        } else {
            let p = if node_path::is_absolute(arg) {
                arg.clone()
            } else {
                format!("{}/{arg}", cwd.strip_suffix('/').unwrap_or(&cwd))
            };
            open_read(&p).map_err(|e| ShellSysError::from_io(&e, arg.as_str()).with_syscall("open"))
        };
        let file = match opened {
            Ok(file) => file,
            Err(err) => {
                let msg = b.task_error_to_string(&err);
                return fail(b, msg.as_bytes(), 1).await;
            }
        };
        // The file is closed when the reader is dropped.
        let code = pump(b, &Reader::file(file)).await;
        if code != 0 {
            return code;
        }
    }
    0
}

#[cfg(test)]
#[path = "cat/tests.rs"]
mod tests;
