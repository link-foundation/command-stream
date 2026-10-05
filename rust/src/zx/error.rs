//! zx-compatible failure formatting (`Fail` helpers): exit code and errno
//! descriptions plus the multi-line messages attached to failed commands.

use std::fmt;

/// Error raised by zx helpers (invalid arguments, unsupported operations, ...).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZxError {
    message: String,
}

impl ZxError {
    /// Create an error with the given message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// The error message.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for ZxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ZxError {}

impl From<std::io::Error> for ZxError {
    fn from(err: std::io::Error) -> Self {
        ZxError::new(err.to_string())
    }
}

/// Base URL of the zx documentation, used in some error messages.
pub const DOCS_URL: &str = "https://google.github.io/zx";

// Conventional shell exit codes and their meaning (data table from zx).
pub const EXIT_CODES: &[(i32, &str)] = &[
    (2, "Misuse of shell builtins"),
    (126, "Invoked command cannot execute"),
    (127, "Command not found"),
    (128, "Invalid exit argument"),
    (129, "Hangup"),
    (130, "Interrupt"),
    (131, "Quit and dump core"),
    (132, "Illegal instruction"),
    (133, "Trace/breakpoint trap"),
    (134, "Process aborted"),
    (
        135,
        "Bus error: \"access to undefined portion of memory object\"",
    ),
    (
        136,
        "Floating point exception: \"erroneous arithmetic operation\"",
    ),
    (137, "Kill (terminate immediately)"),
    (138, "User-defined 1"),
    (139, "Segmentation violation"),
    (140, "User-defined 2"),
    (141, "Write to pipe with no one reading"),
    (142, "Signal raised by alarm"),
    (143, "Termination (request to terminate)"),
    (145, "Child process terminated, stopped (or continued*)"),
    (146, "Continue if stopped"),
    (147, "Stop executing temporarily"),
    (148, "Terminal stop signal"),
    (
        149,
        "Background process attempting to read from tty (\"in\")",
    ),
    (
        150,
        "Background process attempting to write to tty (\"out\")",
    ),
    (151, "Urgent data available on socket"),
    (152, "CPU time limit exceeded"),
    (153, "File size limit exceeded"),
    (
        154,
        "Signal raised by timer counting virtual time: \"virtual timer expired\"",
    ),
    (155, "Profiling timer expired"),
    (157, "Pollable event"),
    (159, "Bad syscall"),
];

/// POSIX errno descriptions indexed by the (positive) errno value.
pub const ERRNO_CODES: &[(i64, &str)] = &[
    (0, "Success"),
    (1, "Not super-user"),
    (2, "No such file or directory"),
    (3, "No such process"),
    (4, "Interrupted system call"),
    (5, "I/O error"),
    (6, "No such device or address"),
    (7, "Arg list too long"),
    (8, "Exec format error"),
    (9, "Bad file number"),
    (10, "No children"),
    (11, "No more processes"),
    (12, "Not enough core"),
    (13, "Permission denied"),
    (14, "Bad address"),
    (15, "Block device required"),
    (16, "Mount device busy"),
    (17, "File exists"),
    (18, "Cross-device link"),
    (19, "No such device"),
    (20, "Not a directory"),
    (21, "Is a directory"),
    (22, "Invalid argument"),
    (23, "Too many open files in system"),
    (24, "Too many open files"),
    (25, "Not a typewriter"),
    (26, "Text file busy"),
    (27, "File too large"),
    (28, "No space left on device"),
    (29, "Illegal seek"),
    (30, "Read only file system"),
    (31, "Too many links"),
    (32, "Broken pipe"),
    (33, "Math arg out of domain of func"),
    (34, "Math result not representable"),
    (35, "File locking deadlock error"),
    (36, "File or path name too long"),
    (37, "No record locks available"),
    (38, "Function not implemented"),
    (39, "Directory not empty"),
    (40, "Too many symbolic links"),
    (42, "No message of desired type"),
    (43, "Identifier removed"),
    (44, "Channel number out of range"),
    (45, "Level 2 not synchronized"),
    (46, "Level 3 halted"),
    (47, "Level 3 reset"),
    (48, "Link number out of range"),
    (49, "Protocol driver not attached"),
    (50, "No CSI structure available"),
    (51, "Level 2 halted"),
    (52, "Invalid exchange"),
    (53, "Invalid request descriptor"),
    (54, "Exchange full"),
    (55, "No anode"),
    (56, "Invalid request code"),
    (57, "Invalid slot"),
    (59, "Bad font file fmt"),
    (60, "Device not a stream"),
    (61, "No data (for no delay io)"),
    (62, "Timer expired"),
    (63, "Out of streams resources"),
    (64, "Machine is not on the network"),
    (65, "Package not installed"),
    (66, "The object is remote"),
    (67, "The link has been severed"),
    (68, "Advertise error"),
    (69, "Srmount error"),
    (70, "Communication error on send"),
    (71, "Protocol error"),
    (72, "Multihop attempted"),
    (73, "Cross mount point (not really error)"),
    (74, "Trying to read unreadable message"),
    (75, "Value too large for defined data type"),
    (76, "Given log. name not unique"),
    (77, "f.d. invalid for this operation"),
    (78, "Remote address changed"),
    (79, "Can   access a needed shared lib"),
    (80, "Accessing a corrupted shared lib"),
    (81, ".lib section in a.out corrupted"),
    (82, "Attempting to link in too many libs"),
    (83, "Attempting to exec a shared library"),
    (84, "Illegal byte sequence"),
    (86, "Streams pipe error"),
    (87, "Too many users"),
    (88, "Socket operation on non-socket"),
    (89, "Destination address required"),
    (90, "Message too long"),
    (91, "Protocol wrong type for socket"),
    (92, "Protocol not available"),
    (93, "Unknown protocol"),
    (94, "Socket type not supported"),
    (95, "Not supported"),
    (96, "Protocol family not supported"),
    (97, "Address family not supported by protocol family"),
    (98, "Address already in use"),
    (99, "Address not available"),
    (100, "Network interface is not configured"),
    (101, "Network is unreachable"),
    (102, "Connection reset by network"),
    (103, "Connection aborted"),
    (104, "Connection reset by peer"),
    (105, "No buffer space available"),
    (106, "Socket is already connected"),
    (107, "Socket is not connected"),
    (108, "Can't send after socket shutdown"),
    (109, "Too many references"),
    (110, "Connection timed out"),
    (111, "Connection refused"),
    (112, "Host is down"),
    (113, "Host is unreachable"),
    (114, "Socket already connected"),
    (115, "Connection already in progress"),
    (116, "Stale file handle"),
    (122, "Quota exceeded"),
    (123, "No medium (in tape drive)"),
    (125, "Operation canceled"),
    (130, "Previous owner died"),
    (131, "State not recoverable"),
];

/// Description of a conventional shell exit code, if known.
pub fn exit_code_info(code: i32) -> Option<&'static str> {
    EXIT_CODES
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, text)| *text)
}

/// Description of a (negative, libuv-style) errno value.
///
/// Unknown values and `None` yield `"Unknown error"`.
pub fn errno_message(errno: Option<i64>) -> &'static str {
    errno
        .and_then(|e| e.checked_neg())
        .and_then(|e| ERRNO_CODES.iter().find(|(c, _)| *c == e))
        .map(|(_, text)| *text)
        .unwrap_or("Unknown error")
}

fn or_null<T: fmt::Display>(value: Option<T>) -> String {
    value.map_or_else(|| "null".to_string(), |v| v.to_string())
}

/// Format the message of a command that exited unsuccessfully.
///
/// `code == Some(0)` without a signal yields just `exit code: 0`.
pub fn format_exit_message(
    code: Option<i32>,
    signal: Option<&str>,
    stderr: &str,
    from: &str,
    details: &str,
) -> String {
    if code == Some(0) && signal.is_none() {
        return "exit code: 0".to_string();
    }
    let mut message = format!("{stderr}\n    at {from}\n    exit code: {}", or_null(code));
    if let Some(info) = code.and_then(exit_code_info) {
        message.push_str(&format!(" ({info})"));
    }
    if let Some(signal) = signal {
        message.push_str(&format!("\n    signal: {signal}"));
    }
    if !details.is_empty() {
        message.push_str(&format!("\n    details: \n{details}"));
    }
    message
}

/// Format the message of a command that could not be run at all
/// (spawn failure, missing working directory, ...).
pub fn format_error_message(
    message: &str,
    errno: Option<i64>,
    code: Option<&str>,
    from: &str,
) -> String {
    let errno_text = errno.map_or_else(|| "undefined".to_string(), |e| e.to_string());
    [
        message.to_string(),
        format!("    errno: {errno_text} ({})", errno_message(errno)),
        format!("    code: {}", code.unwrap_or("undefined")),
        format!("    at {from}"),
    ]
    .join("\n")
}

fn is_error_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    ["fail", "error", "not ok", "exception"]
        .iter()
        .any(|needle| lower.contains(needle))
}

/// Pick the interesting lines of a long output for an error message.
///
/// Fewer than `limit` lines are returned as-is; otherwise lines mentioning
/// `fail`/`error`/`not ok`/`exception` are kept (all lines when none match),
/// truncated to `limit` entries with a trailing `...` marker.
pub fn format_error_details<S: AsRef<str>>(lines: &[S], limit: usize) -> String {
    let all: Vec<&str> = lines.iter().map(|l| l.as_ref()).collect();
    if all.len() < limit {
        return all.join("\n");
    }
    let mut selected: Vec<&str> = all.iter().copied().filter(|l| is_error_line(l)).collect();
    if selected.is_empty() {
        selected = all;
    }
    let more = if selected.len() > limit { "\n..." } else { "" };
    selected.truncate(limit);
    format!("{}{more}", selected.join("\n"))
}

/// Default line limit used by [`format_error_details`].
pub const ERROR_DETAILS_LIMIT: usize = 20;
