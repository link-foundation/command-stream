//! Shell quoting utilities for command-stream
//!
//! This module provides functions for safely quoting values for shell usage,
//! preventing command injection and ensuring proper argument handling.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

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

/// Scan a built command string for an unquoted Go/Handlebars-style template
/// token (`{{ ... }}`) that contains an unquoted space.
///
/// Such a token is split by the shell (and by command-stream, which mirrors
/// shell word-splitting) into multiple argv words, so `--format {{json .X}}`
/// reaches the child as `--format`, `{{json`, `.X}}` — exactly what a POSIX
/// shell would do, but surprising for Go templates. Returns the offending
/// snippet so callers can point the user at the gotcha.
///
/// # Examples
///
/// ```
/// use command_stream::quote::find_split_template_token;
///
/// assert_eq!(
///     find_split_template_token("docker inspect --format {{json .Config.Env}}"),
///     Some("{{json .Config.Env}}".to_string())
/// );
/// // Space-free or quoted tokens are not flagged.
/// assert_eq!(find_split_template_token("docker inspect --format {{.Id}}"), None);
/// assert_eq!(
///     find_split_template_token("docker inspect --format '{{json .Config.Env}}'"),
///     None
/// );
/// ```
pub fn find_split_template_token(command: &str) -> Option<String> {
    if !command.contains("{{") {
        return None;
    }

    let chars: Vec<char> = command.chars().collect();
    let n = chars.len();
    let mut in_single = false;
    let mut in_double = false;
    let mut i = 0;
    while i < n {
        let c = chars[i];
        if in_single {
            in_single = c != '\'';
            i += 1;
            continue;
        }
        if in_double {
            in_double = c != '"';
            i += 1;
            continue;
        }
        if c == '\'' {
            in_single = true;
            i += 1;
            continue;
        }
        if c == '"' {
            in_double = true;
            i += 1;
            continue;
        }

        // An unquoted `{{` — scan forward for its matching `}}`, reporting it
        // when an unquoted space appears in between (which triggers splitting).
        if c == '{' && i + 1 < n && chars[i + 1] == '{' {
            let (splits, end) = scan_template_close(&chars, i + 2);
            if splits {
                return Some(chars[i..=end + 1].iter().collect());
            }
            i = end + 1;
            continue;
        }
        i += 1;
    }

    None
}

/// Starting just after an unquoted `{{`, scan to the matching unquoted `}}`,
/// tracking whether an unquoted space appears in between.
///
/// Returns `(splits, end_index)` where `splits` is true when a closing `}}`
/// was found with an intervening unquoted space, and `end_index` points at the
/// first `}` of that closing pair (or the end of input when no `}}` is found).
fn scan_template_close(chars: &[char], start: usize) -> (bool, usize) {
    let n = chars.len();
    let mut j = start;
    let mut has_unquoted_space = false;
    let mut in_single = false;
    let mut in_double = false;
    while j < n {
        let c = chars[j];
        if in_single {
            in_single = c != '\'';
        } else if in_double {
            in_double = c != '"';
        } else if c == '\'' {
            in_single = true;
        } else if c == '"' {
            in_double = true;
        } else if c == '}' && j + 1 < n && chars[j + 1] == '}' {
            return (has_unquoted_space, j);
        } else if c.is_whitespace() {
            has_unquoted_space = true;
        }
        j += 1;
    }
    (false, j)
}

fn warned_template_snippets() -> &'static Mutex<HashSet<String>> {
    static WARNED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    WARNED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Emit a one-line diagnostic when a built command contains an unquoted Go
/// template token with an internal space. This points users at the
/// shell-splitting gotcha behind the cryptic downstream errors (e.g. Go's
/// "unclosed action"). Silenced via `COMMAND_STREAM_NO_TEMPLATE_WARNING`, and
/// each unique snippet is only reported once per process.
pub fn warn_on_split_template(command: &str) {
    if std::env::var_os("COMMAND_STREAM_NO_TEMPLATE_WARNING").is_some() {
        return;
    }
    let snippet = match find_split_template_token(command) {
        Some(s) => s,
        None => return,
    };
    {
        let mut warned = warned_template_snippets().lock().unwrap();
        if !warned.insert(snippet.clone()) {
            return;
        }
    }
    eprintln!(
        "[command-stream] Warning: template token `{snippet}` contains an \
unquoted space, so the shell splits it into multiple arguments (just like \
bash would). Quote it ('{snippet}') or interpolate it as a single ${{value}} \
to pass it as one argument. See README \"Go templates & {{{{ }}}} arguments\". \
Set COMMAND_STREAM_NO_TEMPLATE_WARNING=1 to silence."
    );
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

    #[test]
    fn test_find_split_template_unquoted_with_space() {
        assert_eq!(
            find_split_template_token("docker inspect --format {{json .Config.Env}}"),
            Some("{{json .Config.Env}}".to_string())
        );
    }

    #[test]
    fn test_find_split_template_space_free() {
        assert_eq!(
            find_split_template_token("docker inspect --format {{.Id}}"),
            None
        );
    }

    #[test]
    fn test_find_split_template_single_quoted() {
        assert_eq!(
            find_split_template_token("docker inspect --format '{{json .Config.Env}}'"),
            None
        );
    }

    #[test]
    fn test_find_split_template_double_quoted() {
        assert_eq!(
            find_split_template_token("docker inspect --format \"{{json .Config.Env}}\""),
            None
        );
    }

    #[test]
    fn test_find_split_template_none_without_braces() {
        assert_eq!(find_split_template_token("echo hello world"), None);
    }
}
