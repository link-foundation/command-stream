//! Port of the zx `test/error.test.ts` suite for `command_stream::zx::error`.

use command_stream::zx::error::{
    errno_message, exit_code_info, format_error_details, format_error_message, format_exit_message,
    ERROR_DETAILS_LIMIT,
};

// zx:test/error.test.ts:30:3:registration
#[test]
fn exit_code_info_values() {
    assert_eq!(exit_code_info(2), Some("Misuse of shell builtins"));
    assert_eq!(exit_code_info(127), Some("Command not found"));
    assert_eq!(exit_code_info(1), None);
}

// zx:test/error.test.ts:34:3:registration
#[test]
fn errno_message_values() {
    assert_eq!(errno_message(Some(-2)), "No such file or directory");
    assert_eq!(errno_message(Some(-1_000_000_000)), "Unknown error");
    assert_eq!(errno_message(None), "Unknown error");
}

// zx:test/error.test.ts:102:3:registration
#[test]
fn exit_message() {
    assert!(format_exit_message(Some(2), None, "", "", "").contains("Misuse of shell builtins"));
    assert_eq!(
        format_exit_message(Some(1), Some("SIGKILL"), "", "", "data"),
        "\n    at \n    exit code: 1\n    signal: SIGKILL\n    details: \ndata"
    );
    assert_eq!(
        format_exit_message(Some(0), None, "", "", ""),
        "exit code: 0"
    );
}

// zx:test/error.test.ts:108:3:registration
#[test]
fn error_message() {
    assert!(format_error_message("", Some(-2), None, "").contains("No such file or directory"));
    assert!(format_error_message("", Some(-1_000_000_000), None, "").contains("Unknown error"));
    assert!(format_error_message("", None, None, "").contains("Unknown error"));
}

// zx:test/error.test.ts:123:3:registration
#[test]
fn find_errors() {
    let lines: Vec<String> = (0..40).map(|v| v.to_string()).collect();
    let empty: [&str; 0] = [];
    assert_eq!(format_error_details(&empty, ERROR_DETAILS_LIMIT), "");
    assert_eq!(
        format_error_details(&["foo", "bar"], ERROR_DETAILS_LIMIT),
        "foo\nbar"
    );
    let mut with_errors = vec!["failure: foo".to_string(), "NOT OK smth".to_string()];
    with_errors.extend(lines.iter().cloned());
    assert_eq!(
        format_error_details(&with_errors, ERROR_DETAILS_LIMIT),
        "failure: foo\nNOT OK smth"
    );
    let sample: Vec<String> = (0..20).map(|v| v.to_string()).collect();
    assert_eq!(
        format_error_details(&lines, ERROR_DETAILS_LIMIT),
        format!("{}\n...", sample.join("\n"))
    );
}
