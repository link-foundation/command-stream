use std::fmt;
use std::time::Duration;

/// Execa-like result metadata, with byte-preserving output.
#[derive(Debug, Clone, Default)]
pub struct ExecaResult {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub all: Option<Vec<u8>>,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub failed: bool,
    pub killed: bool,
    pub timed_out: bool,
    pub is_canceled: bool,
    pub is_max_buffer: bool,
    pub command: String,
    pub escaped_command: String,
    pub duration: Duration,
    pub cause: Option<String>,
}

impl ExecaResult {
    /// Lossy UTF-8 view of stdout; use `stdout` directly for exact bytes.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    pub fn stderr_text(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }

    pub fn stdout_lines(&self) -> Vec<String> {
        lines(&self.stdout)
    }

    pub fn stderr_lines(&self) -> Vec<String> {
        lines(&self.stderr)
    }
}

fn lines(bytes: &[u8]) -> Vec<String> {
    if bytes.is_empty() {
        return Vec::new();
    }
    String::from_utf8_lossy(bytes)
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line).to_string())
        .collect()
}

pub(crate) fn strip_final_newline(bytes: &mut Vec<u8>) {
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
    } else if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
}

/// A failed command retains the same metadata as a successful result.
#[derive(Debug, Clone)]
pub struct ExecaError {
    pub result: Box<ExecaResult>,
}

impl fmt::Display for ExecaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let result = &self.result;
        let reason = if result.timed_out {
            "timed out".to_string()
        } else if result.is_canceled {
            "canceled".to_string()
        } else if result.is_max_buffer {
            "exceeded max_buffer".to_string()
        } else if let Some(cause) = &result.cause {
            cause.clone()
        } else if let Some(signal) = &result.signal {
            format!("killed with {signal}")
        } else {
            format!("failed with exit code {}", result.exit_code.unwrap_or(-1))
        };
        write!(f, "Command {reason}: {}", result.command)
    }
}

impl std::error::Error for ExecaError {}

pub type ExecaOutcome = Result<ExecaResult, ExecaError>;
