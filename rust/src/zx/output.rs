//! [`ProcessOutput`]: the settled result of a zx command.

use std::fmt;
use std::path::Path;
use std::time::Duration;

use regex::Regex;
use serde::de::DeserializeOwned;

use super::error::{exit_code_info, ERROR_DETAILS_LIMIT};
use super::error::{format_error_details, format_error_message, format_exit_message};

/// Why a command could not be run at all (as opposed to exiting non-zero).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ErrorInfo {
    /// Human readable description.
    pub message: String,
    /// Negative errno value (libuv style), when known.
    pub errno: Option<i64>,
    /// Symbolic error code such as `ENOENT`, when known.
    pub code: Option<String>,
}

impl ErrorInfo {
    /// An error described only by its message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            errno: None,
            code: None,
        }
    }

    /// Convert an I/O error, keeping its errno and symbolic code.
    pub fn from_io(err: &std::io::Error) -> Self {
        let raw = err.raw_os_error();
        let code = match err.kind() {
            std::io::ErrorKind::NotFound => Some("ENOENT"),
            std::io::ErrorKind::PermissionDenied => Some("EACCES"),
            std::io::ErrorKind::AlreadyExists => Some("EEXIST"),
            std::io::ErrorKind::BrokenPipe => Some("EPIPE"),
            std::io::ErrorKind::InvalidInput => Some("EINVAL"),
            _ => None,
        };
        Self {
            message: err.to_string(),
            errno: raw.map(|e| -i64::from(e)),
            code: code.map(str::to_string),
        }
    }
}

/// The result of running a command: captured streams, exit status and timing.
///
/// `stdall` holds stdout and stderr interleaved in arrival order. Following
/// zx, the textual accessors ([`text`](Self::text), [`lines`](Self::lines),
/// [`json`](Self::json), [`buffer`](Self::buffer) and `Display`) read
/// `stdall`, which equals `stdout` whenever the command wrote no stderr.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProcessOutput {
    /// Captured standard output.
    pub stdout: String,
    /// Captured standard error.
    pub stderr: String,
    /// Standard output and error interleaved in arrival order.
    pub stdall: String,
    /// Exit code; `None` when the process was killed by a signal or never ran.
    pub exit_code: Option<i32>,
    /// Name of the terminating signal (for example `SIGTERM`).
    pub signal: Option<String>,
    /// Wall-clock run time.
    pub duration: Duration,
    /// Set when the command could not be started.
    pub error: Option<ErrorInfo>,
    /// Where the command came from (the command text by default).
    pub from: String,
}

impl ProcessOutput {
    /// Build an output from its main parts.
    pub fn new(
        exit_code: Option<i32>,
        signal: Option<&str>,
        stdout: impl Into<String>,
        stderr: impl Into<String>,
        stdall: impl Into<String>,
    ) -> Self {
        Self {
            stdout: stdout.into(),
            stderr: stderr.into(),
            stdall: stdall.into(),
            exit_code,
            signal: signal.map(str::to_string),
            ..Default::default()
        }
    }

    /// An output describing a command that could not be run.
    pub fn from_error(error: ErrorInfo, from: impl Into<String>) -> Self {
        Self {
            error: Some(error),
            from: from.into(),
            ..Default::default()
        }
    }

    /// Set the `from` location used in messages.
    pub fn with_from(mut self, from: impl Into<String>) -> Self {
        self.from = from.into();
        self
    }

    /// Set the duration.
    pub fn with_duration(mut self, duration: Duration) -> Self {
        self.duration = duration;
        self
    }

    /// `true` when the command ran and exited with code 0.
    pub fn ok(&self) -> bool {
        self.error.is_none() && self.exit_code == Some(0)
    }

    /// The combined output as text.
    pub fn text(&self) -> String {
        self.stdall.clone()
    }

    /// The combined output hex-encoded (zx `text('hex')`).
    pub fn text_hex(&self) -> String {
        self.stdall.bytes().map(|b| format!("{b:02x}")).collect()
    }

    /// The combined output, trimmed (zx `valueOf()`).
    pub fn value_of(&self) -> &str {
        self.stdall.trim()
    }

    /// The combined output as bytes.
    pub fn buffer(&self) -> Vec<u8> {
        self.stdall.as_bytes().to_vec()
    }

    /// Parse the combined output as JSON.
    pub fn json<T: DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_str(&self.stdall)
    }

    /// Split the combined output on `\r?\n`, dropping a trailing empty piece.
    pub fn lines(&self) -> Vec<String> {
        static NEWLINE: once_cell::sync::Lazy<Regex> =
            once_cell::sync::Lazy::new(|| Regex::new(r"\r?\n").expect("valid regex"));
        finish_lines(NEWLINE.split(&self.stdall).map(str::to_string).collect())
    }

    /// Split the combined output on a custom delimiter.
    pub fn lines_with(&self, delimiter: &str) -> Vec<String> {
        finish_lines(self.stdall.split(delimiter).map(str::to_string).collect())
    }

    /// Description of the exit code (for example `Command not found`).
    pub fn exit_code_info(&self) -> Option<&'static str> {
        self.exit_code.and_then(exit_code_info)
    }

    /// The zx error message for this output.
    pub fn message(&self) -> String {
        if let Some(err) = &self.error {
            return format_error_message(&err.message, err.errno, err.code.as_deref(), &self.from);
        }
        let details = if self.stderr.trim().is_empty() {
            format_error_details(&self.lines(), ERROR_DETAILS_LIMIT)
        } else {
            String::new()
        };
        format_exit_message(
            self.exit_code,
            self.signal.as_deref(),
            &self.stderr,
            &self.from,
            &details,
        )
    }
}

fn finish_lines(mut pieces: Vec<String>) -> Vec<String> {
    if pieces.last().is_some_and(|l| l.is_empty()) {
        pieces.pop();
    }
    pieces
}

impl fmt::Display for ProcessOutput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.stdall)
    }
}

impl std::error::Error for ProcessOutput {}

impl AsRef<Path> for ProcessOutput {
    /// The trimmed combined output as a path (handy for `cd(&output)`).
    fn as_ref(&self) -> &Path {
        Path::new(self.stdall.trim())
    }
}

impl IntoIterator for &ProcessOutput {
    type Item = String;
    type IntoIter = std::vec::IntoIter<String>;

    fn into_iter(self) -> Self::IntoIter {
        self.lines().into_iter()
    }
}
