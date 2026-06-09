//! Shell quoting utilities for command-stream
//!
//! This module provides functions for safely quoting values for shell usage,
//! preventing command injection and ensuring proper argument handling.

/// Quote a value for safe shell usage
///
/// This function quotes strings appropriately for use in shell commands,
/// handling special characters and edge cases.
///
/// # Examples
///
/// ```
/// use command_stream::quote::quote;
///
/// // Safe characters are passed through unchanged
/// assert_eq!(quote("hello"), "hello");
/// assert_eq!(quote("/path/to/file"), "/path/to/file");
///
/// // Special characters are quoted
/// assert_eq!(quote("hello world"), "'hello world'");
///
/// // Single quotes in strings are escaped
/// assert_eq!(quote("it's"), "'it'\\''s'");
///
/// // Empty strings are quoted
/// assert_eq!(quote(""), "''");
/// ```
pub fn quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    // If already properly quoted with single quotes, check if we can use as-is
    if value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2 {
        let inner = &value[1..value.len() - 1];
        if !inner.contains('\'') {
            return value.to_string();
        }
    }

    // If already double-quoted, wrap in single quotes
    if value.starts_with('"') && value.ends_with('"') && value.len() > 2 {
        return format!("'{}'", value);
    }

    // Check if the string needs quoting at all
    // Safe characters: alphanumeric, dash, underscore, dot, slash, colon, equals, comma, plus, at
    let safe_pattern = regex::Regex::new(r"^[a-zA-Z0-9_\-./=,+@:]+$").unwrap();

    if safe_pattern.is_match(value) {
        return value.to_string();
    }

    // Default behavior: wrap in single quotes and escape any internal single quotes
    // The shell escape sequence for a single quote inside single quotes is: '\''
    // This ends the single quote, adds an escaped single quote, and starts single quotes again
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Quote multiple values and join them with spaces
///
/// Convenience function for quoting a list of arguments.
///
/// # Examples
///
/// ```
/// use command_stream::quote::quote_all;
///
/// let args = vec!["echo", "hello world", "test"];
/// assert_eq!(quote_all(&args), "echo 'hello world' test");
/// ```
pub fn quote_all(values: &[&str]) -> String {
    values
        .iter()
        .map(|v| quote(v))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Check if a string needs quoting for shell usage
///
/// Returns true if the string contains characters that would be interpreted
/// specially by the shell.
///
/// # Examples
///
/// ```
/// use command_stream::quote::needs_quoting;
///
/// assert!(!needs_quoting("hello"));
/// assert!(needs_quoting("hello world"));
/// assert!(needs_quoting("$PATH"));
/// ```
pub fn needs_quoting(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }

    let safe_pattern = regex::Regex::new(r"^[a-zA-Z0-9_\-./=,+@:]+$").unwrap();
    !safe_pattern.is_match(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quote_empty() {
        assert_eq!(quote(""), "''");
    }

    #[test]
    fn test_quote_safe_chars() {
        assert_eq!(quote("hello"), "hello");
        assert_eq!(quote("/path/to/file"), "/path/to/file");
        assert_eq!(quote("file.txt"), "file.txt");
        assert_eq!(quote("key=value"), "key=value");
        assert_eq!(quote("user@host"), "user@host");
    }

    #[test]
    fn test_quote_special_chars() {
        assert_eq!(quote("hello world"), "'hello world'");
        assert_eq!(quote("it's"), "'it'\\''s'");
        assert_eq!(quote("$var"), "'$var'");
        assert_eq!(quote("test*"), "'test*'");
    }

    #[test]
    fn test_quote_already_quoted() {
        assert_eq!(quote("'already quoted'"), "'already quoted'");
        assert_eq!(quote("\"double quoted\""), "'\"double quoted\"'");
    }

    #[test]
    fn test_quote_all() {
        let args = vec!["echo", "hello world", "test"];
        assert_eq!(quote_all(&args), "echo 'hello world' test");
    }

    #[test]
    fn test_needs_quoting() {
        assert!(!needs_quoting("hello"));
        assert!(!needs_quoting("/path/to/file"));
        assert!(needs_quoting("hello world"));
        assert!(needs_quoting("$PATH"));
        assert!(needs_quoting(""));
        assert!(needs_quoting("test*"));
    }

    #[test]
    fn test_quote_with_newlines() {
        assert_eq!(quote("line1\nline2"), "'line1\nline2'");
    }

    #[test]
    fn test_quote_with_tabs() {
        assert_eq!(quote("col1\tcol2"), "'col1\tcol2'");
    }
}
