//! The `cp` builtin. Ported from Bun's `src/runtime/shell/builtin/cp.rs` and
//! NodeFS's shell copy (`NewAsyncCpTask`, `copy_single_file_sync`,
//! `cp_symlink` and `mkdir_recursive` in `src/runtime/node/node_fs.rs`)
//! (MIT, Copyright (c) Oven-sh / Jarred Sumner) by way of
//! `js/src/bun-shell/builtins/cp.mjs`.
//!
//! Bun copies each source on its own thread-pool task. With -R, a directory
//! is scanned depth first: each directory is created as it is reached, and
//! every non-directory entry gets its own concurrent copy task. Each task's
//! output (its error to stderr first, then the -v lines to stdout) is
//! written as the task finishes. Like the JavaScript port, this port copies
//! the sources one at a time (each on a blocking task), in argument order.
//! Within a directory it creates all the directories first, then copies the
//! files in scan order.
//!
//! Platform differences:
//!
//! - symlinks are recreated only on Unix (`O_NOFOLLOW` makes their open fail
//!   with ELOOP); Windows follows them, like Node's `fs.openSync`;
//! - on Windows files and directories are opened with
//!   `FILE_FLAG_BACKUP_SEMANTICS` (as libuv does), modes are just the
//!   read-only attribute, and `\` counts as a separator wherever the
//!   JavaScript port looks for `/` (a target ending in a separator, and the
//!   parent directories `mkdir_recursive` creates), as Bun does on Windows.

use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions, Permissions};
use std::io::{self, Read, Write};

use super::small::basename_any;
use crate::bun_shell::builtin::{Builtin, ParseError};
use crate::bun_shell::io::{ShellSysError, Which};
use crate::bun_shell::node_path;

/// cp's options.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Opts {
    recursive: bool,
    verbose: bool,
}

/// The result of Bun's `parse_flags` with cp's options.
#[derive(Debug, PartialEq, Eq)]
enum Parsed {
    /// The options and the index of the first operand.
    Rest(Opts, usize),
    /// Only flags.
    Usage,
    Illegal(String),
    Unsupported(String),
}

/// Only the first character of each flag group counts (`-Rv` is just -R).
fn parse_opts(args: &[String]) -> Parsed {
    let mut opts = Opts::default();
    for (idx, arg) in args.iter().enumerate() {
        if !arg.starts_with('-') {
            return Parsed::Rest(opts, idx);
        }
        let rest = &arg[1..];
        let Some(ch) = rest.chars().next() else {
            return Parsed::Illegal("-".to_string());
        };
        match ch {
            'f' | 'H' | 'i' | 'L' | 'P' => return Parsed::Unsupported(format!("-{ch}")),
            'p' => return Parsed::Unsupported("-P".to_string()),
            'R' => opts.recursive = true,
            'v' => opts.verbose = true,
            'n' => {}
            _ => return Parsed::Illegal(rest.to_string()),
        }
    }
    Parsed::Usage
}

/// A cp task's error: a system error or a custom message.
#[derive(Debug, PartialEq, Eq)]
enum CpErr {
    Sys(ShellSysError),
    Custom(String),
}

impl From<ShellSysError> for CpErr {
    fn from(e: ShellSysError) -> Self {
        CpErr::Sys(e)
    }
}

/// The `-v` output of one task.
struct Log {
    verbose: bool,
    out: String,
}

impl Log {
    fn on_copy(&mut self, s: &str, d: &str) {
        if self.verbose {
            let _ = writeln!(self.out, "{s} -> {d}");
        }
    }
}

fn sys(e: &io::Error, p: &str) -> ShellSysError {
    ShellSysError::from_io(e, p)
}

fn code(e: &io::Error) -> &'static str {
    ShellSysError::from_io(e, "").code
}

/// A path separator where the JavaScript port looks for `/` (see the module
/// docs for Windows).
fn is_sep(c: u8) -> bool {
    c == b'/' || (cfg!(windows) && c == b'\\')
}

fn try_mkdir(p: &str) -> io::Result<()> {
    fs::create_dir(p)
}

fn is_directory(p: &str) -> bool {
    fs::metadata(p).map(|m| m.is_dir()).unwrap_or(false)
}

/// `NodeFS::mkdir_recursive_impl`, with the paths its errors report.
fn mkdir_recursive(p: &str) -> Result<(), ShellSysError> {
    let err = match try_mkdir(p) {
        Ok(()) => return Ok(()),
        Err(e) => e,
    };
    let c = code(&err);
    if c == "EEXIST" || c == "EISDIR" {
        return if is_directory(p) {
            Ok(())
        } else {
            Err(sys(&err, p))
        };
    }
    if c != "ENOENT" || p.is_empty() {
        return Err(sys(&err, p));
    }
    let b = p.as_bytes();
    let mut i = b.len() - 1;
    while i > 0 {
        if is_sep(b[i]) {
            match try_mkdir(&p[..i]) {
                Ok(()) => break,
                Err(e) if code(&e) == "EEXIST" => break,
                Err(e) if code(&e) != "ENOENT" => return Err(sys(&e, &p[..i])),
                Err(_) => {}
            }
        }
        i -= 1;
    }
    for j in i + 1..b.len() {
        if is_sep(b[j]) {
            if let Err(e) = try_mkdir(&p[..j]) {
                if code(&e) != "EEXIST" {
                    return Err(sys(&e, p));
                }
            }
        }
    }
    match try_mkdir(p) {
        Err(e) if code(&e) != "EEXIST" => Err(sys(&e, p)),
        _ => Ok(()),
    }
}

/// Bun's `cp_symlink`: recreate the link, relative targets made absolute.
fn cp_symlink(src: &str, dest: &str) -> Result<(), ShellSysError> {
    let target = fs::read_link(src).map_err(|e| sys(&e, src))?;
    let mut target = target.to_string_lossy().into_owned();
    if !node_path::is_absolute(&target) {
        let parent = std::path::Path::new(src)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| ".".to_string());
        target = node_path::resolve(&[&parent, &target]);
    }
    symlink(&target, dest).map_err(|e| sys(&e, dest))
}

#[cfg(unix)]
fn symlink(target: &str, dest: &str) -> io::Result<()> {
    std::os::unix::fs::symlink(target, dest)
}

#[cfg(windows)]
fn symlink(target: &str, dest: &str) -> io::Result<()> {
    std::os::windows::fs::symlink_file(target, dest)
}

#[cfg(not(any(unix, windows)))]
fn symlink(_target: &str, _dest: &str) -> io::Result<()> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

#[cfg(windows)]
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

/// `fs.openSync(src, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)`.
fn open_src(src: &str) -> io::Result<File> {
    let mut opts = OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        opts.custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
    }
    opts.open(src)
}

/// `fs.openSync(dir, O_DIRECTORY | O_RDONLY | O_NOFOLLOW)`.
fn open_dir(dir: &str) -> io::Result<File> {
    let mut opts = OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        opts.custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
    }
    opts.open(dir)
}

/// `fs.openSync(dest, O_CREAT | O_WRONLY, mode)`.
fn open_dest_once(dest: &str, perms: &Permissions) -> io::Result<File> {
    let mut opts = OpenOptions::new();
    opts.write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        opts.mode(perms.mode());
    }
    #[cfg(not(unix))]
    let _ = perms;
    opts.open(dest)
}

/// `cp_open_dest_with_mkdir`: on ENOENT create the parents and retry.
fn open_dest(dest: &str, perms: &Permissions) -> Result<File, ShellSysError> {
    let err = match open_dest_once(dest, perms) {
        Ok(f) => return Ok(f),
        Err(e) => e,
    };
    if code(&err) == "ENOENT" {
        let end = dest.bytes().rposition(is_sep).map_or(0, |i| i + 1);
        mkdir_recursive(&dest[..end])?;
        if let Ok(f) = open_dest_once(dest, perms) {
            return Ok(f);
        }
    }
    // Report the first error.
    Err(sys(&err, dest))
}

/// The source's mode bits (`st_mode & 0o7777`); the read-only attribute on
/// Windows.
fn mode_of(meta: &fs::Metadata) -> Permissions {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        Permissions::from_mode(meta.mode() & 0o7777)
    }
    #[cfg(not(unix))]
    {
        meta.permissions()
    }
}

/// Bun's `copy_single_file_sync`: symlinks are recreated, other
/// non-regular files fail with ENOTSUP, and the destination is written in
/// place (no `O_TRUNC`), then truncated to the copied size and given the
/// source's mode. A FIFO source is opened with `O_NONBLOCK` and reported
/// right away (Bun's open blocks until a writer appears).
fn copy_single_file(src: &str, dest: &str) -> Result<(), ShellSysError> {
    let mut input = match open_src(src) {
        Ok(f) => f,
        Err(e) if code(&e) == "ELOOP" => return cp_symlink(src, dest),
        Err(e) => return Err(sys(&e, src)),
    };
    let st = input.metadata().map_err(|e| sys(&e, src))?;
    if !st.is_file() {
        return Err(ShellSysError::new("ENOTSUP").with_syscall("copyfile"));
    }
    let perms = mode_of(&st);
    let mut out = open_dest(dest, &perms)?;
    let mut written: u64 = 0;
    let mut buf = vec![0u8; 64 * 1024];
    let copied: io::Result<()> = loop {
        let n = match input.read(&mut buf) {
            Ok(0) => break Ok(()),
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => break Err(e),
        };
        if let Err(e) = out.write_all(&buf[..n]) {
            break Err(e);
        }
        written += n as u64;
    };
    // Best effort.
    if out.set_len(written).is_ok() {
        let _ = out.set_permissions(perms);
    }
    copied.map_err(|e| sys(&e, dest))
}

/// Scan `s` depth first: create `d`, recurse into subdirectories and queue
/// the other entries in `files`.
fn scan(
    s: &str,
    d: &str,
    log: &mut Log,
    files: &mut Vec<(String, String)>,
) -> Result<(), ShellSysError> {
    drop(open_dir(s).map_err(|e| sys(&e, s))?);
    mkdir_recursive(d)?;
    log.on_copy(s, d);
    for ent in fs::read_dir(s).map_err(|e| sys(&e, s))? {
        let ent = ent.map_err(|e| sys(&e, s))?;
        let name = ent.file_name().to_string_lossy().into_owned();
        let cs = format!("{s}/{name}");
        let cd = format!("{d}/{name}");
        if ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            scan(&cs, &cd, log, files)?;
        } else {
            files.push((cs, cd));
        }
    }
    Ok(())
}

/// The -R directory copy: create `dest` and every subdirectory (depth
/// first), then copy the other entries. An EEXIST from an entry is ignored;
/// otherwise the first error wins.
fn copy_dir(src: &str, dest: &str, log: &mut Log) -> Result<(), ShellSysError> {
    let mut files = Vec::new();
    let mut first = scan(src, dest, log, &mut files).err();
    for (s, d) in files {
        match copy_single_file(&s, &d) {
            Ok(()) => log.on_copy(&s, &d),
            Err(e) if e.code != "EEXIST" && first.is_none() => first = Some(e),
            Err(_) => {}
        }
    }
    first.map_or(Ok(()), Err)
}

/// `NewAsyncCpTask::cp_async` with force and without error_on_exist.
fn cp_async(src: &str, dest: &str, recursive: bool, log: &mut Log) -> Result<(), ShellSysError> {
    let st = fs::symlink_metadata(src).map_err(|e| sys(&e, src))?;
    if !st.is_dir() {
        let res = copy_single_file(src, dest);
        log.on_copy(src, dest);
        return match res {
            Err(e) if e.code == "EEXIST" => Ok(()),
            res => res,
        };
    }
    if !recursive {
        return Err(ShellSysError::new("EISDIR")
            .with_path(src)
            .with_syscall("copyfile"));
    }
    copy_dir(src, dest, log)
}

/// Whether `lstat(p)` is a directory.
fn is_dir(p: &str) -> Result<bool, ShellSysError> {
    fs::symlink_metadata(p)
        .map(|m| m.is_dir())
        .map_err(|e| sys(&e, p))
}

/// One `ShellCpTask`: copy `raw_src` to `raw_tgt` (`operands` counts the
/// target too). Returns the error, if any, and the `-v` output.
fn cp_one(
    opts: Opts,
    operands: usize,
    raw_src: &str,
    raw_tgt: &str,
    cwd: &str,
) -> (Option<CpErr>, String) {
    let mut log = Log {
        verbose: opts.verbose,
        out: String::new(),
    };
    let res = cp_one_inner(opts, operands, raw_src, raw_tgt, cwd, &mut log);
    (res.err(), log.out)
}

fn cp_one_inner(
    opts: Opts,
    operands: usize,
    raw_src: &str,
    raw_tgt: &str,
    cwd: &str,
    log: &mut Log,
) -> Result<(), CpErr> {
    let abs = |p: &str| {
        if node_path::is_absolute(p) {
            node_path::join(&[p])
        } else {
            node_path::join(&[cwd, p])
        }
    };
    let src = abs(raw_src);
    let mut tgt = abs(raw_tgt);
    let not_copied = || CpErr::Custom(format!("{raw_src} is a directory (not copied)"));
    let src_is_dir = is_dir(&src)?;
    if src_is_dir && !opts.recursive {
        return Err(not_copied());
    }
    if !src_is_dir && src == tgt {
        return Err(CpErr::Custom(format!(
            "{raw_src} and {raw_src} are identical (not copied)"
        )));
    }
    let (tgt_is_dir, tgt_exists) = match is_dir(&tgt) {
        Ok(d) => (d, true),
        Err(e) if e.code == "ENOENT" => (tgt.bytes().last().is_some_and(is_sep), false),
        Err(e) => return Err(e.into()),
    };
    if !src_is_dir && !tgt_is_dir && operands == 2 {
        // Copy to the target path itself.
    } else if opts.recursive {
        if tgt_exists {
            tgt = node_path::join(&[&tgt, basename_any(&src)]);
        } else if operands != 2 {
            return Err(CpErr::Custom(format!("directory {raw_tgt} does not exist")));
        }
    } else {
        if src_is_dir {
            return Err(not_copied());
        }
        if !tgt_exists || !tgt_is_dir {
            return Err(CpErr::Custom(format!("{raw_tgt} is not a directory")));
        }
        tgt = node_path::join(&[&tgt, basename_any(&src)]);
    }
    Ok(cp_async(&src, &tgt, opts.recursive, log)?)
}

/// The `cp` builtin.
pub(crate) async fn cp(b: &mut Builtin<'_>) -> i32 {
    let (opts, start) = match parse_opts(&b.args) {
        Parsed::Rest(opts, start) if b.args.len() - start > 1 => (opts, start),
        Parsed::Rest(..) | Parsed::Usage => {
            return b.write_failing_error(b.kind.usage(), 1).await;
        }
        Parsed::Unsupported(opt) => return b.fail_parse(ParseError::Unsupported(opt)).await,
        Parsed::Illegal(opt) => return b.fail_parse(ParseError::Illegal(opt)).await,
    };
    let rest = b.args[start..].to_vec();
    let operands = rest.len();
    let target = rest[operands - 1].clone();
    let cwd = b.cwd().to_string();
    let mut failed = false;
    for src in &rest[..operands - 1] {
        let (src, tgt, cwd) = (src.clone(), target.clone(), cwd.clone());
        let task = tokio::task::spawn_blocking(move || cp_one(opts, operands, &src, &tgt, &cwd));
        let (err, out) = task
            .await
            .unwrap_or_else(|e| (Some(CpErr::Custom(e.to_string())), String::new()));
        if let Some(err) = err {
            failed = true;
            let msg = match &err {
                CpErr::Sys(e) => b.shell_err_to_string(e),
                CpErr::Custom(m) => b.fmt_err(&format!("{m}\n")),
            };
            let _ = b.write(Which::Stderr, msg).await;
        }
        let _ = b.write(Which::Stdout, out).await;
    }
    i32::from(failed)
}

#[cfg(test)]
#[path = "cp/tests.rs"]
mod tests;
