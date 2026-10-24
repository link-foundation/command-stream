//! Errno code names, numbers and the GNU-coreutils-style messages Bun Shell
//! prints for them.
//!
//! Ported from `js/src/bun-shell/errno.mjs`, whose tables are generated from
//! Bun's `coreutils_error_map` (`src/sys/coreutils_error_map.rs`, MIT). The
//! Windows error translation follows libuv's `uv_translate_sys_error`
//! (`src/win/error.c`, MIT), which Node (and so the JavaScript port) uses.

fn lookup(table: &'static [(&'static str, &'static str)], code: &str) -> Option<&'static str> {
    table.iter().find(|(k, _)| *k == code).map(|(_, v)| *v)
}

/// The message Bun prints for an errno code name such as `ENOENT` on the
/// given platform (`darwin` selects the macOS overrides).
pub(crate) fn errno_message_for(code: &str, darwin: bool) -> Option<&'static str> {
    if darwin {
        if let Some(m) = lookup(DARWIN, code) {
            return Some(m);
        }
    }
    lookup(BASE, code)
}

/// The message Bun prints for an errno code name on this platform, or `None`
/// for codes it has no message for (callers then print the code itself).
pub(crate) fn errno_message(code: &str) -> Option<&'static str> {
    errno_message_for(code, cfg!(target_vendor = "apple"))
}

// --- code name <-> number ---------------------------------------------------

#[cfg(unix)]
macro_rules! errno_table {
    ($($name:ident),* $(,)?) => {
        &[$((stringify!($name), libc::$name)),*]
    };
}

/// Codes every Unix libc defines. Aliases come after the name Node reports
/// for the shared number (`EAGAIN` before `EWOULDBLOCK`, `ENOTSUP` before
/// `EOPNOTSUPP`), so reverse lookups pick Node's name.
#[cfg(unix)]
const UNIX_CODES: &[(&str, i32)] = errno_table![
    EPERM,
    ENOENT,
    ESRCH,
    EINTR,
    EIO,
    ENXIO,
    E2BIG,
    ENOEXEC,
    EBADF,
    ECHILD,
    EAGAIN,
    ENOMEM,
    EACCES,
    EFAULT,
    ENOTBLK,
    EBUSY,
    EEXIST,
    EXDEV,
    ENODEV,
    ENOTDIR,
    EISDIR,
    EINVAL,
    ENFILE,
    EMFILE,
    ENOTTY,
    ETXTBSY,
    EFBIG,
    ENOSPC,
    ESPIPE,
    EROFS,
    EMLINK,
    EPIPE,
    EDOM,
    ERANGE,
    EDEADLK,
    ENAMETOOLONG,
    ENOLCK,
    ENOSYS,
    ENOTEMPTY,
    ELOOP,
    ENOMSG,
    EIDRM,
    EPROTO,
    EBADMSG,
    EOVERFLOW,
    EILSEQ,
    EUSERS,
    ENOTSOCK,
    EDESTADDRREQ,
    EMSGSIZE,
    EPROTOTYPE,
    ENOPROTOOPT,
    EPROTONOSUPPORT,
    ESOCKTNOSUPPORT,
    ENOTSUP,
    EOPNOTSUPP,
    EPFNOSUPPORT,
    EAFNOSUPPORT,
    EADDRINUSE,
    EADDRNOTAVAIL,
    ENETDOWN,
    ENETUNREACH,
    ENETRESET,
    ECONNABORTED,
    ECONNRESET,
    ENOBUFS,
    EISCONN,
    ENOTCONN,
    ESHUTDOWN,
    ETOOMANYREFS,
    ETIMEDOUT,
    ECONNREFUSED,
    EHOSTDOWN,
    EHOSTUNREACH,
    EALREADY,
    EINPROGRESS,
    ESTALE,
    EDQUOT,
    ECANCELED,
    EOWNERDEAD,
    ENOTRECOVERABLE,
    EREMOTE,
    EWOULDBLOCK,
];

/// Codes shared by Linux and macOS (STREAMS and friends).
#[cfg(any(target_os = "linux", target_os = "android", target_vendor = "apple"))]
const UNIX_EXTRA_CODES: &[(&str, i32)] =
    errno_table![ENOSTR, ENODATA, ETIME, ENOSR, ENOLINK, EMULTIHOP];
#[cfg(all(
    unix,
    not(any(target_os = "linux", target_os = "android", target_vendor = "apple"))
))]
const UNIX_EXTRA_CODES: &[(&str, i32)] = &[];

#[cfg(any(target_os = "linux", target_os = "android"))]
const PLATFORM_CODES: &[(&str, i32)] = errno_table![
    ECHRNG,
    EL2NSYNC,
    EL3HLT,
    EL3RST,
    ELNRNG,
    EUNATCH,
    ENOCSI,
    EL2HLT,
    EBADE,
    EBADR,
    EXFULL,
    ENOANO,
    EBADRQC,
    EBADSLT,
    EBFONT,
    ENONET,
    ENOPKG,
    EADV,
    ESRMNT,
    ECOMM,
    EDOTDOT,
    ENOTUNIQ,
    EBADFD,
    EREMCHG,
    ELIBACC,
    ELIBBAD,
    ELIBSCN,
    ELIBMAX,
    ELIBEXEC,
    ERESTART,
    ESTRPIPE,
    EUCLEAN,
    ENOTNAM,
    ENAVAIL,
    EISNAM,
    EREMOTEIO,
    ENOMEDIUM,
    EMEDIUMTYPE,
    ENOKEY,
    EKEYEXPIRED,
    EKEYREVOKED,
    EKEYREJECTED,
    ERFKILL,
    EHWPOISON,
];
#[cfg(target_vendor = "apple")]
const PLATFORM_CODES: &[(&str, i32)] = errno_table![
    EAUTH,
    EBADARCH,
    EBADEXEC,
    EBADMACHO,
    EBADRPC,
    EDEVERR,
    EFTYPE,
    ENEEDAUTH,
    ENOATTR,
    ENOPOLICY,
    EPROCLIM,
    EPROCUNAVAIL,
    EPROGMISMATCH,
    EPROGUNAVAIL,
    EPWROFF,
    EQFULL,
    ERPCMISMATCH,
    ESHLIBVERS,
];
#[cfg(all(
    unix,
    not(any(target_os = "linux", target_os = "android", target_vendor = "apple"))
))]
const PLATFORM_CODES: &[(&str, i32)] = &[];

#[cfg(unix)]
fn code_table() -> impl Iterator<Item = &'static (&'static str, i32)> {
    UNIX_CODES
        .iter()
        .chain(UNIX_EXTRA_CODES)
        .chain(PLATFORM_CODES)
}

/// libuv's Windows error numbers (`UV__E*`, negated), which Node reports as
/// `err.errno` on Windows and the JavaScript port uses as exit codes.
#[cfg(windows)]
const WINDOWS_CODES: &[(&str, i32)] = &[
    ("E2BIG", 4093),
    ("EACCES", 4092),
    ("EADDRINUSE", 4091),
    ("EADDRNOTAVAIL", 4090),
    ("EAFNOSUPPORT", 4089),
    ("EAGAIN", 4088),
    ("EALREADY", 4084),
    ("EBADF", 4083),
    ("EBUSY", 4082),
    ("ECANCELED", 4081),
    ("ECHARSET", 4080),
    ("ECONNABORTED", 4079),
    ("ECONNREFUSED", 4078),
    ("ECONNRESET", 4077),
    ("EDESTADDRREQ", 4076),
    ("EEXIST", 4075),
    ("EFAULT", 4074),
    ("EHOSTUNREACH", 4073),
    ("EINTR", 4072),
    ("EINVAL", 4071),
    ("EIO", 4070),
    ("EISCONN", 4069),
    ("EISDIR", 4068),
    ("ELOOP", 4067),
    ("EMFILE", 4066),
    ("EMSGSIZE", 4065),
    ("ENAMETOOLONG", 4064),
    ("ENETDOWN", 4063),
    ("ENETUNREACH", 4062),
    ("ENFILE", 4061),
    ("ENOBUFS", 4060),
    ("ENODEV", 4059),
    ("ENOENT", 4058),
    ("ENOMEM", 4057),
    ("ENOSPC", 4055),
    ("ENOSYS", 4054),
    ("ENOTCONN", 4053),
    ("ENOTDIR", 4052),
    ("ENOTEMPTY", 4051),
    ("ENOTSOCK", 4050),
    ("ENOTSUP", 4049),
    ("EPERM", 4048),
    ("EPIPE", 4047),
    ("EPROTO", 4046),
    ("EPROTONOSUPPORT", 4045),
    ("EPROTOTYPE", 4044),
    ("EROFS", 4043),
    ("ESHUTDOWN", 4042),
    ("ESPIPE", 4041),
    ("ESRCH", 4040),
    ("ETIMEDOUT", 4039),
    ("ETXTBSY", 4038),
    ("EXDEV", 4037),
    ("EFBIG", 4036),
    ("ENOPROTOOPT", 4035),
    ("ERANGE", 4034),
    ("ENXIO", 4033),
    ("EMLINK", 4032),
    ("EHOSTDOWN", 4031),
    ("EREMOTEIO", 4030),
    ("ENOTTY", 4029),
    ("EFTYPE", 4028),
    ("EILSEQ", 4027),
    ("ESOCKTNOSUPPORT", 4025),
    ("ENODATA", 4024),
    ("EUNATCH", 4023),
    ("ENOEXEC", 4022),
];

#[cfg(windows)]
fn code_table() -> impl Iterator<Item = &'static (&'static str, i32)> {
    WINDOWS_CODES.iter()
}

/// The (positive) errno number for a code name (Node's
/// `Math.abs(os.constants.errno[code])`), or 0 when unknown.
pub(crate) fn errno_of(code: &str) -> i32 {
    code_table()
        .find(|(k, _)| *k == code)
        .map(|(_, n)| *n)
        .unwrap_or(0)
}

/// The code name for an errno number as returned by [`errno_of`].
#[cfg_attr(not(any(unix, test)), allow(dead_code))]
pub(crate) fn code_of(errno: i32) -> Option<&'static str> {
    code_table().find(|(_, n)| *n == errno).map(|(k, _)| *k)
}

/// The code name for a raw OS error (`io::Error::raw_os_error`): an errno on
/// Unix, a Win32 error code on Windows (translated like libuv does).
pub(crate) fn code_of_raw_os_error(raw: i32) -> Option<&'static str> {
    #[cfg(unix)]
    {
        code_of(raw)
    }
    #[cfg(windows)]
    {
        translate_win32_error(raw)
    }
}

/// libuv's `uv_translate_sys_error` for the Win32/WSA codes std can return.
/// `ERROR_BROKEN_PIPE` maps to `EPIPE` (libuv says `EOF`, which only matters
/// for reads, where std already reports end of file).
#[cfg(any(windows, test))]
pub(crate) fn translate_win32_error(raw: i32) -> Option<&'static str> {
    Some(match raw {
        998 | 10013 | 740 | 1920 => "EACCES",
        5 | 1314 => "EPERM",
        1227 | 10048 => "EADDRINUSE",
        10049 => "EADDRNOTAVAIL",
        10047 => "EAFNOSUPPORT",
        10035 => "EAGAIN",
        10037 => "EALREADY",
        1004 | 6 => "EBADF",
        33 | 231 | 32 => "EBUSY",
        995 | 10004 => "ECANCELED",
        1113 => "ECHARSET",
        1236 | 10053 => "ECONNABORTED",
        1225 | 10061 => "ECONNREFUSED",
        64 | 10054 => "ECONNRESET",
        183 | 80 => "EEXIST",
        111 | 10014 => "EFAULT",
        1232 | 10065 => "EHOSTUNREACH",
        122 | 13 | 87 | 1464 | 10022 | 10046 => "EINVAL",
        1102 | 1111 | 23 | 1166 | 1165 | 1393 | 1129 | 1101 | 31 | 1106 | 1117 | 1104 | 205
        | 110 | 1103 | 156 => "EIO",
        10056 => "EISCONN",
        1921 => "ELOOP",
        4 | 10024 => "EMFILE",
        10040 => "EMSGSIZE",
        206 => "ENAMETOOLONG",
        1231 | 10051 => "ENETUNREACH",
        10055 => "ENOBUFS",
        161 | 203 | 2 | 123 | 15 | 4392 | 126 | 3 | 11001 | 11004 => "ENOENT",
        267 => "ENOTDIR",
        8 | 14 => "ENOMEM",
        82 | 112 | 277 | 1100 | 39 => "ENOSPC",
        2250 | 10057 => "ENOTCONN",
        145 => "ENOTEMPTY",
        10038 => "ENOTSOCK",
        50 => "ENOTSUP",
        109 | 230 | 232 | 233 | 10058 => "EPIPE",
        10043 => "EPROTONOSUPPORT",
        10041 => "EPROTOTYPE",
        19 => "EROFS",
        121 | 10060 => "ETIMEDOUT",
        17 => "EXDEV",
        1 => "EISDIR",
        208 => "E2BIG",
        10044 => "ESOCKTNOSUPPORT",
        193 => "EFTYPE",
        1142 => "EMLINK",
        _ => return None,
    })
}

// --- message tables (generated from js/src/bun-shell/errno.mjs) -------------

/// GNU coreutils messages, in `errno.mjs` order.
#[rustfmt::skip]
const BASE: &[(&str, &str)] = &[
    ("EPERM", "Operation not permitted"),
    ("ENOENT", "No such file or directory"),
    ("ESRCH", "No such process"),
    ("EINTR", "Interrupted system call"),
    ("EIO", "Input/output error"),
    ("ENXIO", "No such device or address"),
    ("E2BIG", "Argument list too long"),
    ("ENOEXEC", "Exec format error"),
    ("EBADF", "Bad file descriptor"),
    ("ECHILD", "No child processes"),
    ("EAGAIN", "Resource temporarily unavailable"),
    ("ENOMEM", "Cannot allocate memory"),
    ("EACCES", "Permission denied"),
    ("EFAULT", "Bad address"),
    ("ENOTBLK", "Block device required"),
    ("EBUSY", "Device or resource busy"),
    ("EEXIST", "File exists"),
    ("EXDEV", "Invalid cross-device link"),
    ("ENODEV", "No such device"),
    ("ENOTDIR", "Not a directory"),
    ("EISDIR", "Is a directory"),
    ("EINVAL", "Invalid argument"),
    ("ENFILE", "Too many open files in system"),
    ("EMFILE", "Too many open files"),
    ("ENOTTY", "Inappropriate ioctl for device"),
    ("ETXTBSY", "Text file busy"),
    ("EFBIG", "File too large"),
    ("ENOSPC", "No space left on device"),
    ("ESPIPE", "Illegal seek"),
    ("EROFS", "Read-only file system"),
    ("EMLINK", "Too many links"),
    ("EPIPE", "Broken pipe"),
    ("EDOM", "Numerical argument out of domain"),
    ("ERANGE", "Numerical result out of range"),
    ("EDEADLK", "Resource deadlock avoided"),
    ("ENAMETOOLONG", "File name too long"),
    ("ENOLCK", "No locks available"),
    ("ENOSYS", "Function not implemented"),
    ("ENOTEMPTY", "Directory not empty"),
    ("ELOOP", "Too many levels of symbolic links"),
    ("ENOMSG", "No message of desired type"),
    ("EIDRM", "Identifier removed"),
    ("ECHRNG", "Channel number out of range"),
    ("EL2NSYNC", "Level 2 not synchronized"),
    ("EL3HLT", "Level 3 halted"),
    ("EL3RST", "Level 3 reset"),
    ("ELNRNG", "Link number out of range"),
    ("EUNATCH", "Protocol driver not attached"),
    ("ENOCSI", "No CSI structure available"),
    ("EL2HLT", "Level 2 halted"),
    ("EBADE", "Invalid exchange"),
    ("EBADR", "Invalid request descriptor"),
    ("EXFULL", "Exchange full"),
    ("ENOANO", "No anode"),
    ("EBADRQC", "Invalid request code"),
    ("EBADSLT", "Invalid slot"),
    ("EBFONT", "Bad font file format"),
    ("ENOSTR", "Device not a stream"),
    ("ENODATA", "No data available"),
    ("ETIME", "Timer expired"),
    ("ENOSR", "Out of streams resources"),
    ("ENONET", "Machine is not on the network"),
    ("ENOPKG", "Package not installed"),
    ("EREMOTE", "Object is remote"),
    ("ENOLINK", "Link has been severed"),
    ("EADV", "Advertise error"),
    ("ESRMNT", "Srmount error"),
    ("ECOMM", "Communication error on send"),
    ("EPROTO", "Protocol error"),
    ("EMULTIHOP", "Multihop attempted"),
    ("EDOTDOT", "RFS specific error"),
    ("EBADMSG", "Bad message"),
    ("EOVERFLOW", "Value too large for defined data type"),
    ("ENOTUNIQ", "Name not unique on network"),
    ("EBADFD", "File descriptor in bad state"),
    ("EREMCHG", "Remote address changed"),
    ("ELIBACC", "Can not access a needed shared library"),
    ("ELIBBAD", "Accessing a corrupted shared library"),
    ("ELIBSCN", ".lib section in a.out corrupted"),
    ("ELIBMAX", "Attempting to link in too many shared libraries"),
    ("ELIBEXEC", "Cannot exec a shared library directly"),
    ("EILSEQ", "Invalid or incomplete multibyte or wide character"),
    ("ERESTART", "Interrupted system call should be restarted"),
    ("ESTRPIPE", "Streams pipe error"),
    ("EUSERS", "Too many users"),
    ("ENOTSOCK", "Socket operation on non-socket"),
    ("EDESTADDRREQ", "Destination address required"),
    ("EMSGSIZE", "Message too long"),
    ("EPROTOTYPE", "Protocol wrong type for socket"),
    ("ENOPROTOOPT", "Protocol not available"),
    ("EPROTONOSUPPORT", "Protocol not supported"),
    ("ESOCKTNOSUPPORT", "Socket type not supported"),
    ("EOPNOTSUPP", "Operation not supported"),
    ("ENOTSUP", "Operation not supported"),
    ("EPFNOSUPPORT", "Protocol family not supported"),
    ("EAFNOSUPPORT", "Address family not supported by protocol"),
    ("EADDRINUSE", "Address already in use"),
    ("EADDRNOTAVAIL", "Cannot assign requested address"),
    ("ENETDOWN", "Network is down"),
    ("ENETUNREACH", "Network is unreachable"),
    ("ENETRESET", "Network dropped connection on reset"),
    ("ECONNABORTED", "Software caused connection abort"),
    ("ECONNRESET", "Connection reset by peer"),
    ("ENOBUFS", "No buffer space available"),
    ("EISCONN", "Transport endpoint is already connected"),
    ("ENOTCONN", "Transport endpoint is not connected"),
    ("ESHUTDOWN", "Cannot send after transport endpoint shutdown"),
    ("ETOOMANYREFS", "Too many references: cannot splice"),
    ("ETIMEDOUT", "Connection timed out"),
    ("ECONNREFUSED", "Connection refused"),
    ("EHOSTDOWN", "Host is down"),
    ("EHOSTUNREACH", "No route to host"),
    ("EALREADY", "Operation already in progress"),
    ("EINPROGRESS", "Operation now in progress"),
    ("ESTALE", "Stale file handle"),
    ("EUCLEAN", "Structure needs cleaning"),
    ("ENOTNAM", "Not a XENIX named type file"),
    ("ENAVAIL", "No XENIX semaphores available"),
    ("EISNAM", "Is a named type file"),
    ("EREMOTEIO", "Remote I/O error"),
    ("EDQUOT", "Disk quota exceeded"),
    ("ENOMEDIUM", "No medium found"),
    ("EMEDIUMTYPE", "Wrong medium type"),
    ("ECANCELED", "Operation canceled"),
    ("ENOKEY", "Required key not available"),
    ("EKEYEXPIRED", "Key has expired"),
    ("EKEYREVOKED", "Key has been revoked"),
    ("EKEYREJECTED", "Key was rejected by service"),
    ("EOWNERDEAD", "Owner died"),
    ("ENOTRECOVERABLE", "State not recoverable"),
    ("ERFKILL", "Operation not possible due to RF-kill"),
    ("EHWPOISON", "Memory page has hardware error"),
];

/// macOS overrides of [`BASE`].
#[rustfmt::skip]
const DARWIN: &[(&str, &str)] = &[
    ("EADDRNOTAVAIL", "Can't assign requested address"),
    ("EAFNOSUPPORT", "Address family not supported by protocol family"),
    ("EAGAIN", "non-blocking and interrupt i/o. Resource temporarily unavailable"),
    ("EAUTH", "Authentication error"),
    ("EBADARCH", "Bad CPU type in executable"),
    ("EBADEXEC", "Program loading errors. Bad executable"),
    ("EBADMACHO", "Malformed Macho file"),
    ("EBADRPC", "RPC struct is bad"),
    ("EBUSY", "Device / Resource busy"),
    ("EDEVERR", "Device error, for example paper out"),
    ("EDOM", "math software. Numerical argument out of domain"),
    ("EDQUOT", "Disc quota exceeded"),
    ("EEXIST", "File or folder exists"),
    ("EFTYPE", "Inappropriate file type or format"),
    ("EILSEQ", "Illegal byte sequence"),
    ("EISCONN", "Socket is already connected"),
    ("EMULTIHOP", "Reserved"),
    ("ENEEDAUTH", "Need authenticator"),
    ("ENETDOWN", "ipc/network software - operational errors Network is down"),
    ("ENOATTR", "Attribute not found"),
    ("ENODATA", "No message available on STREAM"),
    ("ENODEV", "Operation not supported by device"),
    ("ENOLINK", "Reserved"),
    ("ENOMEM", "Out of memory"),
    ("ENOPOLICY", "No such policy registered"),
    ("ENOSR", "No STREAM resources"),
    ("ENOSTR", "Not a STREAM"),
    ("ENOTCONN", "Socket is not connected"),
    ("ENOTSOCK", "ipc/network software - argument errors. Socket operation on non-socket"),
    ("ENOTSUP", "Operation not supported"),
    ("ENXIO", "Device not configured"),
    ("EOVERFLOW", "Value too large to be stored in data type"),
    ("EOWNERDEAD", "Previous owner died"),
    ("EPROCLIM", "quotas & mush. Too many processes"),
    ("EPROCUNAVAIL", "Bad procedure for program"),
    ("EPROGMISMATCH", "Program version wrong"),
    ("EPROGUNAVAIL", "RPC prog. not avail"),
    ("EPWROFF", "Intelligent device errors. Device power is off"),
    ("EQFULL", "Interface output queue is full"),
    ("ERANGE", "Result too large"),
    ("EREMOTE", "Too many levels of remote in path"),
    ("ERPCMISMATCH", "RPC version wrong"),
    ("ESHLIBVERS", "Shared library version mismatch"),
    ("ESHUTDOWN", "Can't send after socket shutdown"),
    ("ESTALE", "Network File System. Stale NFS file handle"),
    ("ETIME", "STREAM ioctl timeout"),
    ("ETIMEDOUT", "Operation timed out"),
    ("ETOOMANYREFS", "Too many references: can't splice"),
    ("EWOULDBLOCK", "Operation would block"),
    ("EXDEV", "Cross-device link"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages() {
        assert_eq!(
            errno_message_for("ENOENT", false),
            Some("No such file or directory")
        );
        assert_eq!(errno_message_for("EEXIST", false), Some("File exists"));
        assert_eq!(
            errno_message_for("EEXIST", true),
            Some("File or folder exists")
        );
        assert_eq!(
            errno_message_for("ENOENT", true),
            Some("No such file or directory")
        );
        assert_eq!(errno_message_for("EAUTH", false), None);
        assert_eq!(
            errno_message_for("EAUTH", true),
            Some("Authentication error")
        );
        assert_eq!(errno_message_for("NOPE", false), None);
        assert_eq!(BASE.len(), 132);
        assert_eq!(DARWIN.len(), 50);
    }

    #[test]
    fn numbers_round_trip() {
        for code in [
            "ENOENT",
            "EACCES",
            "EPIPE",
            "ENOSPC",
            "ENOTDIR",
            "ENAMETOOLONG",
        ] {
            let n = errno_of(code);
            assert!(n > 0, "{code}");
            assert_eq!(code_of(n), Some(code));
        }
        assert_eq!(errno_of("NOPE"), 0);
        #[cfg(unix)]
        {
            assert_eq!(errno_of("ENOENT"), libc::ENOENT);
            assert_eq!(code_of(libc::EAGAIN), Some("EAGAIN"));
            assert_eq!(code_of(libc::ENOTSUP), Some("ENOTSUP"));
            assert_eq!(code_of_raw_os_error(libc::EPIPE), Some("EPIPE"));
        }
        #[cfg(target_os = "linux")]
        assert_eq!(errno_of("EHWPOISON"), 133);
        assert_eq!(translate_win32_error(2), Some("ENOENT"));
        assert_eq!(translate_win32_error(5), Some("EPERM"));
        assert_eq!(translate_win32_error(123_456), None);
    }
}
