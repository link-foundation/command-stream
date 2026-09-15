//! Integration tests for utility functions
//!
//! These tests mirror the JavaScript utility tests

use command_stream::utils::{quote, AnsiConfig, AnsiUtils, CommandResult, VirtualUtils};
use command_stream::Error;
use std::path::PathBuf;

// ============================================================================
// CommandResult Tests
// ============================================================================

#[test]
fn test_command_result_success() {
    let result = CommandResult::success("hello");
    assert!(result.is_success());
    assert_eq!(result.stdout, "hello");
    assert_eq!(result.stderr, "");
    assert_eq!(result.code, 0);
}

#[test]
fn test_command_result_success_empty() {
    let result = CommandResult::success_empty();
    assert!(result.is_success());
    assert_eq!(result.stdout, "");
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
    let result = CommandResult::error_with_code("not found", 127);
    assert!(!result.is_success());
    assert_eq!(result.code, 127);
}

#[test]
fn test_command_result_exit_code_alias() {
    // `exit_code()` is an alias for the `code` field (issue #36)
    let success = CommandResult::success("hello");
    assert_eq!(success.exit_code(), 0);
    assert_eq!(success.exit_code(), success.code);

    let failure = CommandResult::error_with_code("not found", 127);
    assert_eq!(failure.exit_code(), 127);
    assert_eq!(failure.exit_code(), failure.code);
}

// ============================================================================
// Error Exit Code Tests
// ============================================================================

#[test]
fn test_error_code_and_exit_code_alias() {
    // Node.js names the property `code`, execa/zx/nano-spawn/Bun Shell name it
    // `exitCode`; command-stream answers to both spellings (issue #38)
    let error = Error::command_failed(42, "Command failed with exit code 42");
    assert_eq!(error.code(), Some(42));
    assert_eq!(error.exit_code(), Some(42));
    assert_eq!(error.exit_code(), error.code());
}

#[test]
fn test_error_code_for_missing_and_cancelled_commands() {
    // `command not found` is 127 and an interrupted command is 128 + SIGINT,
    // matching the statuses reported by POSIX shells and the JS implementation
    assert_eq!(Error::CommandNotFound("nope".into()).code(), Some(127));
    assert_eq!(Error::Cancelled.code(), Some(130));

    let missing = Error::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"));
    assert_eq!(missing.code(), Some(127));
    assert_eq!(missing.exit_code(), missing.code());

    let denied = Error::Io(std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "denied",
    ));
    assert_eq!(denied.code(), Some(126));
}

#[test]
fn test_error_without_exit_status_reports_none() {
    // Failures that never reached a child process have no exit status
    let error = Error::ParseError("unbalanced quote".into());
    assert_eq!(error.code(), None);
    assert_eq!(error.exit_code(), None);
}

#[test]
fn test_error_for_status_keeps_successful_results() {
    let result = CommandResult::success("hello").error_for_status().unwrap();
    assert_eq!(result.stdout, "hello");
    assert_eq!(result.code, 0);
}

#[test]
fn test_error_for_status_turns_failures_into_errors() {
    let error = CommandResult::error_with_code("boom", 23)
        .error_for_status()
        .unwrap_err();

    assert_eq!(error.code(), Some(23));
    assert_eq!(error.exit_code(), Some(23));
    assert!(error.to_string().contains("23"));
}

// ============================================================================
// VirtualUtils Tests
// ============================================================================

#[test]
fn test_missing_operand_error() {
    let result = VirtualUtils::missing_operand_error("cat");
    assert!(!result.is_success());
    assert!(result.stderr.contains("cat"));
    assert!(result.stderr.contains("missing operand"));
}

#[test]
fn test_invalid_argument_error() {
    let result = VirtualUtils::invalid_argument_error("test", "invalid option");
    assert!(!result.is_success());
    assert!(result.stderr.contains("test"));
    assert!(result.stderr.contains("invalid option"));
}

#[test]
fn test_validate_args_sufficient() {
    let args = vec!["arg1".to_string()];
    let error = VirtualUtils::validate_args(&args, 1, "cmd");
    assert!(error.is_none());
}

#[test]
fn test_validate_args_insufficient() {
    let args = vec![];
    let error = VirtualUtils::validate_args(&args, 1, "cmd");
    assert!(error.is_some());
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
fn test_resolve_path_relative_with_cwd() {
    let cwd = PathBuf::from("/home/user");
    let path = VirtualUtils::resolve_path("relative/path", Some(&cwd));
    assert_eq!(path, PathBuf::from("/home/user/relative/path"));
}

#[test]
fn test_resolve_path_relative_without_cwd() {
    let path = VirtualUtils::resolve_path("relative/path", None);
    // Should resolve relative to current directory
    assert!(path.ends_with("relative/path"));
}

// ============================================================================
// AnsiUtils Tests
// ============================================================================

#[test]
fn test_strip_ansi_basic() {
    let text = "\x1b[31mRed text\x1b[0m";
    assert_eq!(AnsiUtils::strip_ansi(text), "Red text");
}

#[test]
fn test_strip_ansi_multiple() {
    let text = "\x1b[1m\x1b[31mBold Red\x1b[0m normal";
    let result = AnsiUtils::strip_ansi(text);
    assert_eq!(result, "Bold Red normal");
}

#[test]
fn test_strip_ansi_no_sequences() {
    let text = "plain text";
    assert_eq!(AnsiUtils::strip_ansi(text), "plain text");
}

#[test]
fn test_strip_ansi_color_codes() {
    let text = "\x1b[32mGreen\x1b[0m and \x1b[34mBlue\x1b[0m";
    assert_eq!(AnsiUtils::strip_ansi(text), "Green and Blue");
}

#[test]
fn test_strip_control_chars_basic() {
    let text = "Hello\x00World";
    assert_eq!(AnsiUtils::strip_control_chars(text), "HelloWorld");
}

#[test]
fn test_strip_control_chars_preserve_newline() {
    let text = "Line1\nLine2";
    assert_eq!(AnsiUtils::strip_control_chars(text), "Line1\nLine2");
}

#[test]
fn test_strip_control_chars_preserve_tab() {
    let text = "Col1\tCol2";
    assert_eq!(AnsiUtils::strip_control_chars(text), "Col1\tCol2");
}

#[test]
fn test_strip_control_chars_preserve_carriage_return() {
    let text = "Line1\r\nLine2";
    assert_eq!(AnsiUtils::strip_control_chars(text), "Line1\r\nLine2");
}

#[test]
fn test_strip_all() {
    let text = "\x1b[31mRed\x00text\x1b[0m\nNewline";
    let result = AnsiUtils::strip_all(text);
    assert_eq!(result, "Redtext\nNewline");
}

// ============================================================================
// AnsiConfig Tests
// ============================================================================

#[test]
fn test_ansi_config_default() {
    let config = AnsiConfig::default();
    assert!(config.preserve_ansi);
    assert!(config.preserve_control_chars);
}

#[test]
fn test_ansi_config_process_preserve_all() {
    let config = AnsiConfig {
        preserve_ansi: true,
        preserve_control_chars: true,
    };
    let text = "\x1b[31mRed\x00text\x1b[0m";
    let result = config.process_output(text);
    assert_eq!(result, text);
}

#[test]
fn test_ansi_config_process_strip_ansi_only() {
    let config = AnsiConfig {
        preserve_ansi: false,
        preserve_control_chars: true,
    };
    let text = "\x1b[31mRed text\x1b[0m";
    let result = config.process_output(text);
    assert_eq!(result, "Red text");
}

#[test]
fn test_ansi_config_process_strip_control_only() {
    let config = AnsiConfig {
        preserve_ansi: true,
        preserve_control_chars: false,
    };
    let text = "Hello\x00World\nNewline";
    let result = config.process_output(text);
    assert_eq!(result, "HelloWorld\nNewline");
}

#[test]
fn test_ansi_config_process_strip_all() {
    let config = AnsiConfig {
        preserve_ansi: false,
        preserve_control_chars: false,
    };
    let text = "\x1b[31mRed\x00text\x1b[0m";
    let result = config.process_output(text);
    assert_eq!(result, "Redtext");
}

// ============================================================================
// Quote Function Tests
// ============================================================================

#[test]
fn test_quote_empty_string() {
    assert_eq!(quote(""), "''");
}

#[test]
fn test_quote_simple_string() {
    assert_eq!(quote("hello"), "hello");
}

#[test]
fn test_quote_path() {
    assert_eq!(quote("/path/to/file"), "/path/to/file");
}

#[test]
fn test_quote_with_spaces() {
    assert_eq!(quote("hello world"), "'hello world'");
}

#[test]
fn test_quote_with_single_quote() {
    assert_eq!(quote("it's"), "'it'\\''s'");
}

#[test]
fn test_quote_already_single_quoted() {
    // Quote characters are data, like "$var" in sh (issue #41).
    assert_eq!(quote("'hello'"), "''\\''hello'\\'''");
}

#[test]
fn test_quote_already_double_quoted() {
    let result = quote("\"hello\"");
    assert!(result.contains("hello"));
}

#[test]
fn test_quote_safe_characters() {
    // These should not need quoting
    assert_eq!(quote("file.txt"), "file.txt");
    assert_eq!(quote("path/to/file"), "path/to/file");
    assert_eq!(quote("key=value"), "key=value");
    assert_eq!(quote("user@host"), "user@host");
}

#[test]
fn test_quote_special_characters() {
    // These need quoting
    let result = quote("hello$world");
    assert!(result.starts_with("'") && result.ends_with("'"));

    let result = quote("hello;world");
    assert!(result.starts_with("'") && result.ends_with("'"));

    let result = quote("hello|world");
    assert!(result.starts_with("'") && result.ends_with("'"));
}

#[test]
fn test_quote_newline() {
    let result = quote("hello\nworld");
    assert!(result.contains("hello"));
    assert!(result.contains("world"));
}
