//! Glob errors, shaped like Node.js system errors.

use super::*;

/// A walker error. System errors mirror Bun's `SystemError` (and the JS
/// port's): `code` (`"ENOENT"`, ...), a negative `errno`, `syscall`
/// (`"open"`, `"fstatat"`, `"getdents64"`) and `path`; `message` is
/// `"<code>: <description>, <syscall> '<path>'"`. Other errors (an invalid
/// `cwd`, an OS error without a known errno name) have `code == None`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GlobError {
    pub(crate) code: Option<&'static str>,
    pub(crate) errno: Option<i32>,
    pub(crate) syscall: &'static str,
    pub(crate) path: String,
    pub(crate) message: String,
}

impl GlobError {
    pub(super) fn sys(code: &'static str, syscall: &'static str, path: &str) -> Self {
        Self {
            code: Some(code),
            errno: errno_for_code(code).map(|n| -n),
            syscall,
            path: path.to_string(),
            message: format!("{code}: {}, {syscall} '{path}'", description(code)),
        }
    }

    pub(super) fn other(message: String) -> Self {
        Self {
            code: None,
            errno: None,
            syscall: "",
            path: String::new(),
            message,
        }
    }

    /// Whether this is a system error with the given code.
    pub(crate) fn is(&self, code: &str) -> bool {
        self.code == Some(code)
    }
}

impl fmt::Display for GlobError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for GlobError {}

/// Descriptions of libuv's `uv_strerror` (Node's `util.getSystemErrorMap`).
pub(super) fn description(code: &str) -> &str {
    match code {
        "EPERM" => "operation not permitted",
        "ENOENT" => "no such file or directory",
        "ESRCH" => "no such process",
        "EINTR" => "interrupted system call",
        "EIO" => "i/o error",
        "ENXIO" => "no such device or address",
        "E2BIG" => "argument list too long",
        "ENOEXEC" => "exec format error",
        "EBADF" => "bad file descriptor",
        "EAGAIN" => "resource temporarily unavailable",
        "ENOMEM" => "not enough memory",
        "EACCES" => "permission denied",
        "EFAULT" => "bad address in system call argument",
        "EBUSY" => "resource busy or locked",
        "EEXIST" => "file already exists",
        "EXDEV" => "cross-device link not permitted",
        "ENODEV" => "no such device",
        "ENOTDIR" => "not a directory",
        "EISDIR" => "illegal operation on a directory",
        "EINVAL" => "invalid argument",
        "ENFILE" => "file table overflow",
        "EMFILE" => "too many open files",
        "ENOTTY" => "inappropriate ioctl for device",
        "ETXTBSY" => "text file is busy",
        "EFBIG" => "file too large",
        "ENOSPC" => "no space left on device",
        "ESPIPE" => "invalid seek",
        "EROFS" => "read-only file system",
        "EMLINK" => "too many links",
        "EPIPE" => "broken pipe",
        "ENAMETOOLONG" => "name too long",
        "ENOSYS" => "function not implemented",
        "ENOTEMPTY" => "directory not empty",
        "ELOOP" => "too many symbolic links encountered",
        "EOVERFLOW" => "value too large for defined data type",
        "EILSEQ" => "illegal byte sequence",
        "ECANCELED" => "operation canceled",
        "ETIMEDOUT" => "connection timed out",
        other => other,
    }
}

#[cfg(unix)]
pub(super) const ERRNO_CODES: &[(i32, &str)] = &[
    (libc::EPERM, "EPERM"),
    (libc::ENOENT, "ENOENT"),
    (libc::ESRCH, "ESRCH"),
    (libc::EINTR, "EINTR"),
    (libc::EIO, "EIO"),
    (libc::ENXIO, "ENXIO"),
    (libc::E2BIG, "E2BIG"),
    (libc::ENOEXEC, "ENOEXEC"),
    (libc::EBADF, "EBADF"),
    (libc::ECHILD, "ECHILD"),
    (libc::EAGAIN, "EAGAIN"),
    (libc::ENOMEM, "ENOMEM"),
    (libc::EACCES, "EACCES"),
    (libc::EFAULT, "EFAULT"),
    (libc::EBUSY, "EBUSY"),
    (libc::EEXIST, "EEXIST"),
    (libc::EXDEV, "EXDEV"),
    (libc::ENODEV, "ENODEV"),
    (libc::ENOTDIR, "ENOTDIR"),
    (libc::EISDIR, "EISDIR"),
    (libc::EINVAL, "EINVAL"),
    (libc::ENFILE, "ENFILE"),
    (libc::EMFILE, "EMFILE"),
    (libc::ENOTTY, "ENOTTY"),
    (libc::ETXTBSY, "ETXTBSY"),
    (libc::EFBIG, "EFBIG"),
    (libc::ENOSPC, "ENOSPC"),
    (libc::ESPIPE, "ESPIPE"),
    (libc::EROFS, "EROFS"),
    (libc::EMLINK, "EMLINK"),
    (libc::EPIPE, "EPIPE"),
    (libc::ENAMETOOLONG, "ENAMETOOLONG"),
    (libc::ENOSYS, "ENOSYS"),
    (libc::ENOTEMPTY, "ENOTEMPTY"),
    (libc::ELOOP, "ELOOP"),
    (libc::EOVERFLOW, "EOVERFLOW"),
    (libc::ESTALE, "ESTALE"),
    (libc::EILSEQ, "EILSEQ"),
    (libc::ECANCELED, "ECANCELED"),
    (libc::ETIMEDOUT, "ETIMEDOUT"),
];

/// The values of Node's `os.constants.errno` on Windows (the MSVC CRT's).
#[cfg(not(unix))]
pub(super) const ERRNO_CODES: &[(i32, &str)] = &[
    (1, "EPERM"),
    (2, "ENOENT"),
    (5, "EIO"),
    (7, "E2BIG"),
    (9, "EBADF"),
    (12, "ENOMEM"),
    (13, "EACCES"),
    (16, "EBUSY"),
    (17, "EEXIST"),
    (18, "EXDEV"),
    (20, "ENOTDIR"),
    (21, "EISDIR"),
    (22, "EINVAL"),
    (24, "EMFILE"),
    (28, "ENOSPC"),
    (30, "EROFS"),
    (38, "ENAMETOOLONG"),
    (41, "ENOTEMPTY"),
    (114, "ELOOP"),
];

pub(super) fn errno_for_code(code: &str) -> Option<i32> {
    ERRNO_CODES
        .iter()
        .find(|(_, c)| *c == code)
        .map(|(n, _)| *n)
}

/// The errno name of an I/O error (Node's `err.code`).
#[cfg(unix)]
pub(super) fn io_error_code(e: &io::Error) -> Option<&'static str> {
    let raw = e.raw_os_error()?;
    ERRNO_CODES.iter().find(|(n, _)| *n == raw).map(|(_, c)| *c)
}

/// The errno name of an I/O error, following libuv's mapping of Windows
/// error codes (`uv_translate_sys_error`).
#[cfg(not(unix))]
pub(super) fn io_error_code(e: &io::Error) -> Option<&'static str> {
    if let Some(raw) = e.raw_os_error() {
        let code = match raw {
            2 | 3 | 15 | 123 | 161 | 1920 => Some("ENOENT"),
            5 | 1314 => Some("EPERM"),
            267 => Some("ENOTDIR"),
            206 => Some("ENAMETOOLONG"),
            1921 => Some("ELOOP"),
            4 => Some("EMFILE"),
            32 | 33 | 170 => Some("EBUSY"),
            80 | 183 => Some("EEXIST"),
            145 => Some("ENOTEMPTY"),
            _ => None,
        };
        if code.is_some() {
            return code;
        }
    }
    match e.kind() {
        io::ErrorKind::NotFound => Some("ENOENT"),
        io::ErrorKind::PermissionDenied => Some("EACCES"),
        io::ErrorKind::NotADirectory => Some("ENOTDIR"),
        io::ErrorKind::IsADirectory => Some("EISDIR"),
        io::ErrorKind::AlreadyExists => Some("EEXIST"),
        io::ErrorKind::DirectoryNotEmpty => Some("ENOTEMPTY"),
        _ => None,
    }
}

/// `rethrowAs`: an OS error becomes a `SystemError` for `syscall`/`path`.
pub(super) fn rethrow(e: &io::Error, syscall: &'static str, path: &str) -> GlobError {
    match io_error_code(e) {
        Some(code) => GlobError::sys(code, syscall, path),
        None => GlobError::other(e.to_string()),
    }
}
