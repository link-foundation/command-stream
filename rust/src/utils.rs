//! Utility functions and types for command-stream
//!
//! This module provides helper functions for command results, virtual command
//! utilities, and re-exports from specialized utility modules.
//!
//! ## Module Organization
//!
//! The utilities are organized into focused modules following the same
//! modular pattern as the JavaScript implementation:
//!
//! - `trace` - Logging and tracing utilities
//! - `ansi` - ANSI escape code handling
//! - `quote` - Shell quoting utilities
//! - `utils` (this module) - Command results and virtual command helpers

use crate::result_streams::{CapturedInput, CapturedOutput};
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};

// Re-export from specialized modules for backwards compatibility
pub use crate::ansi::{AnsiConfig, AnsiUtils};
pub use crate::quote::quote;
pub use crate::trace::{is_trace_enabled, trace, trace_lazy};

/// Re-export invocation-local directory variables inside POSIX shells.
///
/// Some shells, notably the macOS system shell, import `OLDPWD` as an
/// internal variable but drop its export flag during startup. Prefixing the
/// command keeps both variables visible to the real child process.
#[cfg(unix)]
pub(crate) fn with_exported_process_context(
    command: &str,
    env: Option<&HashMap<String, String>>,
) -> String {
    let Some(env) = env else {
        return command.to_string();
    };
    let assignments = ["PWD", "OLDPWD"]
        .into_iter()
        .filter_map(|name| {
            env.get(name).map(|value| {
                let value = value.replace('\'', "'\\''");
                format!("{name}='{value}'")
            })
        })
        .collect::<Vec<_>>();

    if assignments.is_empty() {
        command.to_string()
    } else {
        format!("export {}; {command}", assignments.join(" "))
    }
}

#[cfg(not(unix))]
pub(crate) fn with_exported_process_context(
    command: &str,
    _env: Option<&HashMap<String, String>>,
) -> String {
    command.to_string()
}

#[derive(Debug, Clone)]
struct ShellConfig {
    cmd: String,
    args: Vec<String>,
    raw_command_arg: bool,
}

fn find_available_shell() -> ShellConfig {
    #[cfg(windows)]
    let shells: &[(&str, &[&str], bool)] = &[
        (r"C:\Program Files\Git\bin\bash.exe", &["-c"], false),
        (r"C:\Program Files\Git\usr\bin\bash.exe", &["-c"], false),
        (r"C:\Program Files (x86)\Git\bin\bash.exe", &["-c"], false),
        ("bash.exe", &["-c"], false),
        ("wsl.exe", &["bash", "-c"], false),
        ("powershell.exe", &["-Command"], false),
        ("pwsh.exe", &["-Command"], false),
        ("cmd.exe", &["/c"], true),
    ];

    #[cfg(not(windows))]
    let shells: &[(&str, &[&str], bool)] = &[
        ("/bin/sh", &["-c"], false),
        ("/usr/bin/sh", &["-c"], false),
        ("/bin/bash", &["-c"], false),
        ("sh", &["-c"], false),
    ];

    for (cmd, args, raw_command_arg) in shells {
        if Path::new(cmd).exists() || which::which(cmd).is_ok() {
            return ShellConfig {
                cmd: (*cmd).to_string(),
                args: args.iter().map(|arg| (*arg).to_string()).collect(),
                raw_command_arg: *raw_command_arg,
            };
        }
    }

    #[cfg(windows)]
    return ShellConfig {
        cmd: "cmd.exe".to_string(),
        args: vec!["/c".to_string()],
        raw_command_arg: true,
    };

    #[cfg(not(windows))]
    ShellConfig {
        cmd: "/bin/sh".to_string(),
        args: vec!["-c".to_string()],
        raw_command_arg: false,
    }
}

#[cfg(windows)]
fn append_command_arg(process: &mut tokio::process::Command, command: &str, raw_command_arg: bool) {
    if raw_command_arg {
        // `cmd.exe /c` does not use the C runtime's argument decoder. Passing
        // the command through `arg` would therefore expose Rust's backslash
        // escapes as literal characters. The extra outer quotes are required
        // to preserve a quoted executable path at the start of the command.
        use std::os::windows::process::CommandExt;
        process.as_std_mut().raw_arg(format!("\"{command}\""));
    } else {
        process.arg(command);
    }
}

#[cfg(not(windows))]
fn append_command_arg(
    process: &mut tokio::process::Command,
    command: &str,
    _raw_command_arg: bool,
) {
    process.arg(command);
}

/// Build a command using the best platform shell and its argument convention.
pub(crate) fn shell_command(
    command: &str,
    env: Option<&HashMap<String, String>>,
) -> tokio::process::Command {
    let shell = find_available_shell();
    let mut process = tokio::process::Command::new(&shell.cmd);
    process.args(&shell.args);
    let command = with_exported_process_context(command, env);
    append_command_arg(&mut process, &command, shell.raw_command_arg);
    process
}

/// Result type for virtual command operations
#[derive(Debug, Clone)]
pub struct CommandResult {
    pub stdout: CapturedOutput,
    pub stderr: CapturedOutput,
    pub stdin: CapturedInput,
    pub code: i32,
}

impl CommandResult {
    /// Create a result with readable output snapshots and a writable input record.
    pub fn new(
        stdout: impl Into<CapturedOutput>,
        stderr: impl Into<CapturedOutput>,
        code: i32,
    ) -> Self {
        Self {
            stdout: stdout.into(),
            stderr: stderr.into(),
            stdin: CapturedInput::default(),
            code,
        }
    }

    /// Create a success result with stdout output
    pub fn success(stdout: impl Into<String>) -> Self {
        Self::new(stdout.into(), "", 0)
    }

    /// Create an empty success result
    pub fn success_empty() -> Self {
        Self::new("", "", 0)
    }

    /// Create an error result with stderr output
    pub fn error(stderr: impl Into<String>) -> Self {
        Self::new("", stderr.into(), 1)
    }

    /// Create an error result with custom exit code
    pub fn error_with_code(stderr: impl Into<String>, code: i32) -> Self {
        Self::new("", stderr.into(), code)
    }

    /// Check if the command was successful
    pub fn is_success(&self) -> bool {
        self.code == 0
    }

    /// Exit code of the command.
    ///
    /// This is an alias for the [`code`](Self::code) field, mirroring the
    /// `exitCode` alias exposed by the JavaScript implementation (issue #36).
    pub fn exit_code(&self) -> i32 {
        self.code
    }

    /// Turn a failing result into [`crate::Error::CommandFailed`].
    ///
    /// This is the Rust counterpart of the JavaScript `errexit` mode: a
    /// non-zero status becomes an error whose exit status is readable through
    /// both [`crate::Error::code`] and [`crate::Error::exit_code`] (issue
    /// #38). Successful results pass through unchanged.
    ///
    /// ```
    /// use command_stream::utils::CommandResult;
    ///
    /// let error = CommandResult::error_with_code("", 42)
    ///     .error_for_status()
    ///     .unwrap_err();
    /// assert_eq!(error.code(), Some(42));
    /// assert_eq!(error.exit_code(), error.code());
    /// ```
    pub fn error_for_status(self) -> crate::Result<CommandResult> {
        if self.is_success() {
            return Ok(self);
        }

        Err(crate::Error::command_failed(
            self.code,
            format!("Command failed with exit code {}", self.code),
        ))
    }
}

/// Utility functions for virtual commands
pub struct VirtualUtils;

impl VirtualUtils {
    /// Create standardized error response for missing operands
    pub fn missing_operand_error(command_name: &str) -> CommandResult {
        CommandResult::error(format!("{}: missing operand", command_name))
    }

    /// Create standardized error response for missing operands with custom message
    pub fn missing_operand_error_with_message(command_name: &str, message: &str) -> CommandResult {
        CommandResult::error(format!("{}: {}", command_name, message))
    }

    /// Create standardized error response for invalid arguments
    pub fn invalid_argument_error(command_name: &str, message: &str) -> CommandResult {
        CommandResult::error(format!("{}: {}", command_name, message))
    }

    /// Create standardized success response
    pub fn success(stdout: impl Into<String>) -> CommandResult {
        CommandResult::success(stdout)
    }

    /// Create standardized error response
    pub fn error(stderr: impl Into<String>) -> CommandResult {
        CommandResult::error(stderr)
    }

    /// Validate that command has required number of arguments
    pub fn validate_args(
        args: &[String],
        min_count: usize,
        command_name: &str,
    ) -> Option<CommandResult> {
        if args.len() < min_count {
            if min_count == 1 {
                return Some(Self::missing_operand_error(command_name));
            } else {
                return Some(Self::invalid_argument_error(
                    command_name,
                    &format!("requires at least {} arguments", min_count),
                ));
            }
        }
        None // No error
    }

    /// Resolve file path with optional cwd parameter
    pub fn resolve_path(file_path: &str, cwd: Option<&Path>) -> PathBuf {
        let path = Path::new(file_path);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            let base_path = cwd
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from("/")));
            base_path.join(path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_result_success() {
        let result = CommandResult::success("hello");
        assert!(result.is_success());
        assert_eq!(result.stdout, "hello");
        assert_eq!(result.stderr, "");
        assert_eq!(result.code, 0);
    }

    #[test]
    fn test_command_result_error() {
        let result = CommandResult::error("something went wrong");
        assert!(!result.is_success());
        assert_eq!(result.stdout, "");
        assert_eq!(result.stderr, "something went wrong");
        assert_eq!(result.code, 1);
    }

    #[test]
    fn test_command_result_error_with_code() {
        let result = CommandResult::error_with_code("permission denied", 126);
        assert!(!result.is_success());
        assert_eq!(result.code, 126);
    }

    #[test]
    fn test_resolve_path_absolute() {
        let absolute_path = if cfg!(windows) {
            PathBuf::from(r"C:\absolute\path")
        } else {
            PathBuf::from("/absolute/path")
        };
        let path = VirtualUtils::resolve_path(absolute_path.to_str().unwrap(), None);
        assert_eq!(path, absolute_path);
    }

    #[test]
    fn test_resolve_path_relative() {
        let cwd = PathBuf::from("/home/user");
        let path = VirtualUtils::resolve_path("relative/path", Some(&cwd));
        assert_eq!(path, PathBuf::from("/home/user/relative/path"));
    }

    #[test]
    fn test_validate_args_success() {
        let args = vec!["arg1".to_string()];
        assert!(VirtualUtils::validate_args(&args, 1, "cmd").is_none());
    }

    #[test]
    fn test_validate_args_missing() {
        let args = vec!["arg1".to_string()];
        let result = VirtualUtils::validate_args(&args, 2, "cmd");
        assert!(result.is_some());
    }

    #[test]
    fn test_missing_operand_error() {
        let result = VirtualUtils::missing_operand_error("cat");
        assert!(!result.is_success());
        assert!(result.stderr.contains("missing operand"));
    }

    #[test]
    fn test_invalid_argument_error() {
        let result = VirtualUtils::invalid_argument_error("ls", "invalid option");
        assert!(!result.is_success());
        assert!(result.stderr.contains("invalid option"));
    }

    // Re-exported module tests are in their respective modules
    // These tests verify the re-exports work correctly

    #[test]
    fn test_reexported_quote() {
        assert_eq!(quote("hello"), "hello");
        assert_eq!(quote("hello world"), "'hello world'");
    }

    #[test]
    fn test_reexported_ansi_utils() {
        let text = "\x1b[31mRed text\x1b[0m";
        assert_eq!(AnsiUtils::strip_ansi(text), "Red text");
    }

    #[test]
    fn test_reexported_ansi_config() {
        let config = AnsiConfig::default();
        assert!(config.preserve_ansi);
        assert!(config.preserve_control_chars);
    }

    #[cfg(unix)]
    #[test]
    fn safely_exports_invocation_directory_variables() {
        let env = HashMap::from([
            ("PWD".to_string(), "/tmp/new dir".to_string()),
            (
                "OLDPWD".to_string(),
                "/tmp/old' dir\n$() `cmd`; end".to_string(),
            ),
        ]);

        assert_eq!(
            with_exported_process_context("printf done", Some(&env)),
            "export PWD='/tmp/new dir' OLDPWD='/tmp/old'\\'' dir\n$() `cmd`; end'; printf done"
        );
    }
}
