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

use std::env;
use std::path::{Path, PathBuf};

// Re-export from specialized modules for backwards compatibility
pub use crate::trace::{is_trace_enabled, trace, trace_lazy};
pub use crate::ansi::{AnsiConfig, AnsiUtils};
pub use crate::quote::quote;

/// Result type for virtual command operations
#[derive(Debug, Clone)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

impl CommandResult {
    /// Create a success result with stdout output
    pub fn success(stdout: impl Into<String>) -> Self {
        CommandResult {
            stdout: stdout.into(),
            stderr: String::new(),
            code: 0,
        }
    }

    /// Create an empty success result
    pub fn success_empty() -> Self {
        CommandResult {
            stdout: String::new(),
            stderr: String::new(),
            code: 0,
        }
    }

    /// Create an error result with stderr output
    pub fn error(stderr: impl Into<String>) -> Self {
        CommandResult {
            stdout: String::new(),
            stderr: stderr.into(),
            code: 1,
        }
    }

    /// Create an error result with custom exit code
    pub fn error_with_code(stderr: impl Into<String>, code: i32) -> Self {
        CommandResult {
            stdout: String::new(),
            stderr: stderr.into(),
            code,
        }
    }

    /// Check if the command was successful
    pub fn is_success(&self) -> bool {
        self.code == 0
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
    pub fn missing_operand_error_with_message(
        command_name: &str,
        message: &str,
    ) -> CommandResult {
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
            let base_path = cwd.map(|p| p.to_path_buf()).unwrap_or_else(|| {
                env::current_dir().unwrap_or_else(|_| PathBuf::from("/"))
            });
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
        let path = VirtualUtils::resolve_path("/absolute/path", None);
        assert_eq!(path, PathBuf::from("/absolute/path"));
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
}
