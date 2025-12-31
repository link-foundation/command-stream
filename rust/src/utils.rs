//! Utility functions and types for command-stream
//!
//! This module provides helper functions for tracing, error handling,
//! and common file system operations used by virtual commands.

use std::env;
use std::path::{Path, PathBuf};

/// Check if tracing is enabled via environment variables
///
/// Tracing can be controlled via:
/// - COMMAND_STREAM_TRACE=true/false (explicit control)
/// - COMMAND_STREAM_VERBOSE=true (enables tracing unless TRACE=false)
pub fn is_trace_enabled() -> bool {
    let trace_env = env::var("COMMAND_STREAM_TRACE").ok();
    let verbose_env = env::var("COMMAND_STREAM_VERBOSE")
        .map(|v| v == "true")
        .unwrap_or(false);

    match trace_env.as_deref() {
        Some("false") => false,
        Some("true") => true,
        _ => verbose_env,
    }
}

/// Trace function for verbose logging
///
/// Outputs trace messages to stderr when tracing is enabled.
/// Messages are prefixed with timestamp and category.
pub fn trace(category: &str, message: &str) {
    if !is_trace_enabled() {
        return;
    }

    let timestamp = chrono::Utc::now().to_rfc3339();
    eprintln!("[TRACE {}] [{}] {}", timestamp, category, message);
}

/// Trace function with lazy message evaluation
///
/// Only evaluates the message function if tracing is enabled.
pub fn trace_lazy<F>(category: &str, message_fn: F)
where
    F: FnOnce() -> String,
{
    if !is_trace_enabled() {
        return;
    }

    trace(category, &message_fn());
}

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

/// ANSI control character utilities
pub struct AnsiUtils;

impl AnsiUtils {
    /// Strip ANSI escape sequences from text
    pub fn strip_ansi(text: &str) -> String {
        let re = regex::Regex::new(r"\x1b\[[0-9;]*[mGKHFJ]").unwrap();
        re.replace_all(text, "").to_string()
    }

    /// Strip control characters from text, preserving newlines, carriage returns, and tabs
    pub fn strip_control_chars(text: &str) -> String {
        text.chars()
            .filter(|c| {
                // Preserve newlines (\n = \x0A), carriage returns (\r = \x0D), and tabs (\t = \x09)
                !matches!(*c as u32,
                    0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F | 0x7F
                )
            })
            .collect()
    }

    /// Strip both ANSI sequences and control characters
    pub fn strip_all(text: &str) -> String {
        Self::strip_control_chars(&Self::strip_ansi(text))
    }

    /// Clean data for processing (strips ANSI and control chars)
    pub fn clean_for_processing(data: &str) -> String {
        Self::strip_all(data)
    }
}

/// Configuration for ANSI handling
#[derive(Debug, Clone)]
pub struct AnsiConfig {
    pub preserve_ansi: bool,
    pub preserve_control_chars: bool,
}

impl Default for AnsiConfig {
    fn default() -> Self {
        AnsiConfig {
            preserve_ansi: true,
            preserve_control_chars: true,
        }
    }
}

impl AnsiConfig {
    /// Process output according to config settings
    pub fn process_output(&self, data: &str) -> String {
        if !self.preserve_ansi && !self.preserve_control_chars {
            AnsiUtils::clean_for_processing(data)
        } else if !self.preserve_ansi {
            AnsiUtils::strip_ansi(data)
        } else if !self.preserve_control_chars {
            AnsiUtils::strip_control_chars(data)
        } else {
            data.to_string()
        }
    }
}

/// Quote a value for safe shell usage
pub fn quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    // If already properly quoted, check if we can use as-is
    if value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2 {
        let inner = &value[1..value.len() - 1];
        if !inner.contains('\'') {
            return value.to_string();
        }
    }

    if value.starts_with('"') && value.ends_with('"') && value.len() > 2 {
        // If already double-quoted, wrap in single quotes
        return format!("'{}'", value);
    }

    // Check if the string needs quoting at all
    // Safe characters: alphanumeric, dash, underscore, dot, slash, colon, equals, comma, plus
    let safe_pattern = regex::Regex::new(r"^[a-zA-Z0-9_\-./=,+@:]+$").unwrap();

    if safe_pattern.is_match(value) {
        return value.to_string();
    }

    // Default behavior: wrap in single quotes and escape any internal single quotes
    format!("'{}'", value.replace('\'', "'\\''"))
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
    fn test_strip_ansi() {
        let text = "\x1b[31mRed text\x1b[0m";
        assert_eq!(AnsiUtils::strip_ansi(text), "Red text");
    }

    #[test]
    fn test_strip_control_chars() {
        let text = "Hello\x00World\nNew line\tTab";
        assert_eq!(AnsiUtils::strip_control_chars(text), "HelloWorld\nNew line\tTab");
    }

    #[test]
    fn test_quote_empty() {
        assert_eq!(quote(""), "''");
    }

    #[test]
    fn test_quote_safe_chars() {
        assert_eq!(quote("hello"), "hello");
        assert_eq!(quote("/path/to/file"), "/path/to/file");
    }

    #[test]
    fn test_quote_special_chars() {
        assert_eq!(quote("hello world"), "'hello world'");
        assert_eq!(quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn test_validate_args() {
        let args = vec!["arg1".to_string()];
        assert!(VirtualUtils::validate_args(&args, 1, "cmd").is_none());
        assert!(VirtualUtils::validate_args(&args, 2, "cmd").is_some());
    }
}
