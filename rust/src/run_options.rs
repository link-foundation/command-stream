//! Public execution options and errors.

use crate::{signal, PreferLocal};
use std::collections::HashMap;
use std::path::PathBuf;

/// Error type for command-stream operations
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Command failed with exit code {code}: {message}")]
    CommandFailed { code: i32, message: String },

    #[error("Command not found: {0}")]
    CommandNotFound(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Cancelled")]
    Cancelled,
}

impl Error {
    /// Build a [`Error::CommandFailed`] for a command that exited with `code`.
    pub fn command_failed(code: i32, message: impl Into<String>) -> Self {
        Error::CommandFailed {
            code,
            message: message.into(),
        }
    }

    /// Exit status carried by the error, when the failure has one.
    ///
    /// Mirrors the `error.code` property of the JavaScript implementation
    /// (issue #38). Failures that never reached a child process, such as parse
    /// errors, report `None`.
    pub fn code(&self) -> Option<i32> {
        match self {
            Error::CommandFailed { code, .. } => Some(*code),
            // `command not found` is 127 in POSIX shells, which is also what
            // the JavaScript implementation reports for a missing executable.
            Error::CommandNotFound(_) => Some(127),
            Error::Io(error) => match error.kind() {
                std::io::ErrorKind::NotFound => Some(127),
                std::io::ErrorKind::PermissionDenied => Some(126),
                _ => None,
            },
            // A cancelled command is terminated with SIGINT (128 + 2).
            Error::Cancelled => Some(130),
            Error::ParseError(_) => None,
        }
    }

    /// Alias for [`code`](Self::code).
    ///
    /// Node.js `child_process` names this property `code`, while execa, zx,
    /// nano-spawn, and Bun Shell name it `exitCode`. command-stream exposes
    /// both spellings in every language (issue #38).
    pub fn exit_code(&self) -> Option<i32> {
        self.code()
    }
}

/// Result type for command-stream operations
pub type Result<T> = std::result::Result<T, Error>;

/// Options for command execution
#[derive(Debug, Clone)]
pub struct RunOptions {
    /// Mirror output to parent stdout/stderr
    pub mirror: bool,
    /// Capture output in result
    pub capture: bool,
    /// Standard input handling
    pub stdin: StdinOption,
    /// Working directory
    pub cwd: Option<PathBuf>,
    /// Environment variables
    pub env: Option<HashMap<String, String>>,
    /// Prefer executables from the working directory or explicit local directories.
    pub prefer_local: PreferLocal,
    /// Interactive mode (TTY forwarding)
    pub interactive: bool,
    /// Enable shell operator parsing
    pub shell_operators: bool,
    /// Enable tracing for this command
    pub trace: bool,
    /// Signal used to stop the process when it is killed without an explicit
    /// signal, i.e. [`crate::ProcessRunner::kill`] (default `SIGTERM`).
    ///
    /// Mirrors the JavaScript `killSignal` option. An explicit
    /// [`crate::ProcessRunner::kill_with`] argument always overrides it.
    pub kill_signal: String,
    /// Milliseconds the child is given to handle the kill signal before
    /// `SIGKILL` is sent (default 100).
    ///
    /// Mirrors the JavaScript `killGrace` option. This is the window in which a
    /// child running its own signal handler can shut down on its own terms.
    pub kill_grace_ms: u64,
}

impl Default for RunOptions {
    fn default() -> Self {
        RunOptions {
            mirror: true,
            capture: true,
            stdin: StdinOption::Inherit,
            cwd: None,
            env: None,
            prefer_local: PreferLocal::Off,
            interactive: false,
            shell_operators: true,
            trace: true,
            kill_signal: signal::DEFAULT_KILL_SIGNAL.to_string(),
            kill_grace_ms: signal::DEFAULT_KILL_GRACE_MS,
        }
    }
}

/// Standard input options
#[derive(Debug, Clone)]
pub enum StdinOption {
    /// Inherit from parent process
    Inherit,
    /// Pipe (allow writing to stdin)
    Pipe,
    /// Provide string content
    Content(String),
    /// Null device
    Null,
}
