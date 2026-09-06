//! Shell quoting utilities for command-stream
//!
//! This module provides functions for safely quoting values for shell usage,
//! preventing command injection and ensuring proper argument handling.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

/// Whether the legacy pre-quoted passthrough heuristic is active.
///
/// Older versions treated a value that happened to start and end with a quote
/// character as "already quoted" and spliced it into the command as shell
/// syntax, so the value `'/My Documents/x'` reached the command as
/// `/My Documents/x` - the quotes vanished. sh does the opposite: `"$var"`
/// always yields the value verbatim, quote characters included, which is also
/// what Bun's $, zx and execa do. Worse, the heuristic could hand the shell
/// unbalanced quotes, and an injected command ran (issue #41).
///
/// The heuristic is therefore off by default; set
/// `COMMAND_STREAM_PREQUOTED_PASSTHROUGH=1` to restore it for code that relies
/// on hand-quoted values. Even then only values that stay balanced are passed
/// through, so the injection above can no longer happen.
pub fn is_pre_quoted_passthrough_enabled() -> bool {
    matches!(
        std::env::var("COMMAND_STREAM_PREQUOTED_PASSTHROUGH"),
        Ok(ref value) if value == "1"
    )
}

/// Whether a value is wrapped in matching quotes that contain none of that
/// quote character inside, i.e. it is balanced shell syntax on its own.
fn is_balanced_quoted_value(value: &str) -> bool {
    let quote_char = match value.chars().next() {
        Some(c @ ('\'' | '"')) => c,
        _ => return false,
    };
    if value.chars().count() < 2 || !value.ends_with(quote_char) {
        return false;
    }
    let inner = &value[quote_char.len_utf8()..value.len() - quote_char.len_utf8()];
    !inner.contains(quote_char)
}

/// Quote a value for safe shell usage
///
/// The value is always treated as literal text - exactly one argument, spaces
/// and quote characters included - which is what `"$var"` does in sh.
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
/// // Paths with spaces stay a single argument
/// assert_eq!(quote("/My Documents/report.txt"), "'/My Documents/report.txt'");
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

    // Legacy: the caller quoted the value themselves, so use it as shell syntax.
    if is_pre_quoted_passthrough_enabled() && is_balanced_quoted_value(value) {
        return value.to_string();
    }

    // Check if the string needs quoting at all
    // Safe characters: alphanumeric, dash, underscore, dot, slash, colon, equals, comma, plus, at
    let safe_pattern = regex::Regex::new(r"^[a-zA-Z0-9_\-./=,+@:]+$").unwrap();

    if safe_pattern.is_match(value) {
        return value.to_string();
    }

    // Wrap in single quotes and escape any internal single quotes.
    // The shell escape sequence for a single quote inside single quotes is: '\''
    // This ends the single quote, adds an escaped single quote, and starts single quotes again
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Where in a command an interpolated value lands.
///
/// A tagged template / format string can place an interpolation inside quotes
/// the author wrote themselves, e.g. `s!("bash -c \"{}\"", script)`. Wrapping
/// the value in single quotes there produces `bash -c "'...'"`, which the
/// inner shell refuses to run (issue #49). Inside quotes the value is instead
/// spliced in as escaped literal text, exactly like `"$var"` in a POSIX shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuoteContext {
    /// Outside any quotes: the value is fully quoted.
    Unquoted,
    /// Inside `'...'` written by the author.
    Single,
    /// Inside `"..."` written by the author.
    Double,
}

/// Whether context-aware quoting is enabled.
///
/// On by default; set `COMMAND_STREAM_QUOTE_CONTEXT=0` to restore the previous
/// behaviour of always single-quoting interpolated values.
pub fn is_quote_context_enabled() -> bool {
    match std::env::var("COMMAND_STREAM_QUOTE_CONTEXT") {
        Ok(value) => value != "0",
        Err(_) => true,
    }
}

/// Advance the shell quoting state across a literal chunk of a template.
///
/// Only the template's own text is scanned - interpolated values never change
/// the state, which is exactly why they cannot break out of their quotes.
///
/// # Examples
///
/// ```
/// use command_stream::quote::{scan_quote_context, QuoteContext};
///
/// assert_eq!(scan_quote_context("echo ", QuoteContext::Unquoted), QuoteContext::Unquoted);
/// assert_eq!(scan_quote_context("bash -c \"", QuoteContext::Unquoted), QuoteContext::Double);
/// assert_eq!(scan_quote_context("echo '", QuoteContext::Unquoted), QuoteContext::Single);
/// ```
pub fn scan_quote_context(text: &str, context: QuoteContext) -> QuoteContext {
    let chars: Vec<char> = text.chars().collect();
    let mut current = context;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match current {
            QuoteContext::Single => {
                // Inside '...' nothing is special except the closing quote.
                if c == '\'' {
                    current = QuoteContext::Unquoted;
                }
            }
            QuoteContext::Double => {
                // Inside "..." a backslash escapes the next character.
                if c == '\\' {
                    i += 2;
                    continue;
                }
                if c == '"' {
                    current = QuoteContext::Unquoted;
                }
            }
            QuoteContext::Unquoted => {
                if c == '\\' {
                    i += 2;
                    continue;
                }
                if c == '\'' {
                    current = QuoteContext::Single;
                } else if c == '"' {
                    current = QuoteContext::Double;
                }
            }
        }
        i += 1;
    }
    current
}

/// Escape a value so it can sit inside `'...'` as literal text.
///
/// A single quote is emitted as `'\''` - close, escaped quote, reopen - which
/// is the standard POSIX idiom.
///
/// # Examples
///
/// ```
/// use command_stream::quote::escape_for_single_quotes;
///
/// assert_eq!(escape_for_single_quotes("plain $text"), "plain $text");
/// assert_eq!(escape_for_single_quotes("it's"), "it'\\''s");
/// ```
pub fn escape_for_single_quotes(value: &str) -> String {
    value.replace('\'', "'\\''")
}

/// Escape a value so it can sit inside `"..."` as literal text.
///
/// Backslash, dollar, backtick and double quote are the only characters the
/// shell still interprets inside double quotes, so escaping them makes the
/// value literal - the inner program (e.g. `bash -c`) sees the original text.
///
/// # Examples
///
/// ```
/// use command_stream::quote::escape_for_double_quotes;
///
/// assert_eq!(escape_for_double_quotes("plain text"), "plain text");
/// assert_eq!(escape_for_double_quotes("$HOME"), "\\$HOME");
/// ```
pub fn escape_for_double_quotes(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('$', "\\$")
        .replace('`', "\\`")
        .replace('"', "\\\"")
}

/// Quote a value for the context it is interpolated into.
///
/// In an unquoted position this is plain [`quote`]. Inside quotes the value is
/// inserted as escaped literal text, without adding another layer of quotes.
///
/// # Examples
///
/// ```
/// use command_stream::quote::{quote_for_context, QuoteContext};
///
/// assert_eq!(quote_for_context("hello world", QuoteContext::Unquoted), "'hello world'");
/// assert_eq!(quote_for_context("hello world", QuoteContext::Double), "hello world");
/// assert_eq!(quote_for_context("it's", QuoteContext::Single), "it'\\''s");
/// ```
pub fn quote_for_context(value: &str, context: QuoteContext) -> String {
    match context {
        QuoteContext::Unquoted => quote(value),
        // Inside quotes an empty value expands to nothing, like "$unset".
        QuoteContext::Single => escape_for_single_quotes(value),
        QuoteContext::Double => escape_for_double_quotes(value),
    }
}

/// Characters a backslash may escape inside double quotes, per POSIX.
fn is_double_quote_escape(char: Option<char>) -> bool {
    matches!(
        char,
        Some('$') | Some('`') | Some('"') | Some('\\') | Some('\n')
    )
}

/// Detect backslash escapes that a real shell removes but the lightweight
/// built-in command path keeps verbatim.
///
/// Commands like this are routed to the system shell, which is the only way to
/// get exactly the POSIX result - important now that interpolating a value into
/// a quoted position escapes it (issue #49).
///
/// # Examples
///
/// ```
/// use command_stream::quote::has_shell_escapes;
///
/// assert!(has_shell_escapes("echo \"5 \\$US\""));
/// assert!(!has_shell_escapes("echo \"plain\""));
/// assert!(!has_shell_escapes("echo 'a \\$b'"));
/// ```
pub fn has_shell_escapes(command: &str) -> bool {
    if !command.contains('\\') {
        return false;
    }
    let chars: Vec<char> = command.chars().collect();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match quote {
            // Inside '...' a backslash is an ordinary character.
            Some('\'') => {
                if c == '\'' {
                    quote = None;
                }
            }
            Some('"') => {
                if c == '\\' {
                    if is_double_quote_escape(chars.get(i + 1).copied()) {
                        return true;
                    }
                    i += 2;
                    continue;
                }
                if c == '"' {
                    quote = None;
                }
            }
            _ => {
                if c == '\\' {
                    // Outside quotes a backslash escapes whatever follows it.
                    if i + 1 < chars.len() {
                        return true;
                    }
                } else if c == '"' || c == '\'' {
                    quote = Some(c);
                }
            }
        }
        i += 1;
    }
    false
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
    fn test_quote_treats_quote_characters_as_data() {
        // Quote characters inside a value are data, exactly like "$var" in sh -
        // they never quote the value itself (issue #41).
        assert_eq!(quote("'already quoted'"), "''\\''already quoted'\\'''");
        assert_eq!(quote("\"double quoted\""), "'\"double quoted\"'");
        // The old "already double-quoted" shortcut emitted '"it's"', which the
        // shell rejects as an unterminated quoted string.
        assert_eq!(quote("\"it's\""), "'\"it'\\''s\"'");
    }

    #[test]
    fn test_quote_paths_with_spaces() {
        assert_eq!(
            quote("/Users/john/My Documents/report.txt"),
            "'/Users/john/My Documents/report.txt'"
        );
        assert_eq!(
            quote("C:\\Program Files\\App\\app.exe"),
            "'C:\\Program Files\\App\\app.exe'"
        );
        assert_eq!(quote("  /tmp/spaced  "), "'  /tmp/spaced  '");
        assert_eq!(
            quote("/tmp/it's a dir/f.txt"),
            "'/tmp/it'\\''s a dir/f.txt'"
        );
    }

    #[test]
    fn test_pre_quoted_passthrough_disabled_by_default() {
        // The opt-in is read from the environment on every call, so with the
        // variable unset the sh-like literal behaviour must be in effect.
        if std::env::var("COMMAND_STREAM_PREQUOTED_PASSTHROUGH").is_err() {
            assert!(!is_pre_quoted_passthrough_enabled());
        }
    }

    #[test]
    fn test_balanced_quoted_value_detection() {
        assert!(is_balanced_quoted_value("'/My Documents/f.txt'"));
        assert!(is_balanced_quoted_value("\"/My Documents/f.txt\""));
        // Unbalanced quoting is what made the old heuristic injectable.
        assert!(!is_balanced_quoted_value("\"a\" ; touch pwned ; \"b\""));
        assert!(!is_balanced_quoted_value("'a' ; touch pwned ; 'b'"));
        assert!(!is_balanced_quoted_value("/plain/path"));
        assert!(!is_balanced_quoted_value("'"));
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

#[cfg(test)]
mod quote_context_tests {
    use super::*;
    use crate::macros::build_shell_command;

    #[test]
    fn test_scan_quote_context_tracks_quotes() {
        assert_eq!(
            scan_quote_context("echo ", QuoteContext::Unquoted),
            QuoteContext::Unquoted
        );
        assert_eq!(
            scan_quote_context("bash -c \"", QuoteContext::Unquoted),
            QuoteContext::Double
        );
        assert_eq!(
            scan_quote_context("echo '", QuoteContext::Unquoted),
            QuoteContext::Single
        );
        assert_eq!(
            scan_quote_context("\" rest", QuoteContext::Double),
            QuoteContext::Unquoted
        );
        assert_eq!(
            scan_quote_context("' rest", QuoteContext::Single),
            QuoteContext::Unquoted
        );
    }

    #[test]
    fn test_scan_quote_context_quotes_are_inert_inside_the_other_quote() {
        // A double quote inside '...' is literal, so the state must not change.
        assert_eq!(
            scan_quote_context("it\"s", QuoteContext::Single),
            QuoteContext::Single
        );
        // ...and a single quote inside "..." is literal too.
        assert_eq!(
            scan_quote_context("it's", QuoteContext::Double),
            QuoteContext::Double
        );
    }

    #[test]
    fn test_scan_quote_context_honours_escapes() {
        // An escaped quote does not open or close anything.
        assert_eq!(
            scan_quote_context("echo \\\"", QuoteContext::Unquoted),
            QuoteContext::Unquoted
        );
        assert_eq!(
            scan_quote_context("a \\\" b", QuoteContext::Double),
            QuoteContext::Double
        );
        // Inside single quotes a backslash is literal, so this quote closes.
        assert_eq!(
            scan_quote_context("a \\'", QuoteContext::Single),
            QuoteContext::Unquoted
        );
    }

    #[test]
    fn test_escape_for_single_quotes() {
        assert_eq!(escape_for_single_quotes("plain"), "plain");
        assert_eq!(escape_for_single_quotes("$HOME `id`"), "$HOME `id`");
        assert_eq!(escape_for_single_quotes("it's"), "it'\\''s");
    }

    #[test]
    fn test_escape_for_double_quotes() {
        assert_eq!(escape_for_double_quotes("plain"), "plain");
        assert_eq!(escape_for_double_quotes("$HOME"), "\\$HOME");
        assert_eq!(escape_for_double_quotes("`id`"), "\\`id\\`");
        assert_eq!(escape_for_double_quotes("say \"hi\""), "say \\\"hi\\\"");
        assert_eq!(escape_for_double_quotes("back\\slash"), "back\\\\slash");
        // Apostrophes are ordinary characters inside double quotes.
        assert_eq!(escape_for_double_quotes("it's"), "it's");
    }

    #[test]
    fn test_quote_for_context() {
        assert_eq!(
            quote_for_context("hello world", QuoteContext::Unquoted),
            "'hello world'"
        );
        assert_eq!(
            quote_for_context("hello world", QuoteContext::Double),
            "hello world"
        );
        assert_eq!(
            quote_for_context("hello world", QuoteContext::Single),
            "hello world"
        );
        // Empty values expand to nothing inside quotes, like "$unset".
        assert_eq!(quote_for_context("", QuoteContext::Double), "");
        assert_eq!(quote_for_context("", QuoteContext::Unquoted), "''");
    }

    #[test]
    fn test_build_shell_command_quotes_unquoted_values() {
        assert_eq!(
            build_shell_command(&["echo ", ""], &["hello world"]),
            "echo 'hello world'"
        );
    }

    #[test]
    fn test_build_shell_command_issue_49() {
        // The reported failure: a script interpolated into bash -c "..." was
        // wrapped in single quotes, which bash then refused to run.
        let script = "for file in *.js; do echo \"Processing: $file\"; done";
        assert_eq!(
            build_shell_command(&["bash -c \"", "\""], &[script]),
            "bash -c \"for file in *.js; do echo \\\"Processing: \\$file\\\"; done\""
        );
    }

    #[test]
    fn test_build_shell_command_single_quoted_context() {
        assert_eq!(
            build_shell_command(&["echo '", "'"], &["it's here"]),
            "echo 'it'\\''s here'"
        );
    }

    #[test]
    fn test_build_shell_command_cannot_break_out_of_quotes() {
        // A value trying to close the quote and append a command stays literal.
        let evil = "\"; rm -rf /; echo \"";
        let built = build_shell_command(&["bash -c \"", "\""], &[evil]);
        assert_eq!(built, "bash -c \"\\\"; rm -rf /; echo \\\"\"");
        // Every quote coming from the value is escaped, so `rm -rf /` stays a
        // literal argument of the inner echo instead of a new command.
        assert!(built.contains("\\\"; rm -rf /"));
    }

    #[test]
    fn test_build_shell_command_context_persists_across_parts() {
        // The quote opened in the first part is still open for the second value.
        assert_eq!(
            build_shell_command(&["sh -c \"echo ", " ", "\""], &["a b", "c d"]),
            "sh -c \"echo a b c d\""
        );
    }

    #[test]
    fn test_has_shell_escapes() {
        assert!(!has_shell_escapes("echo hello"));
        assert!(!has_shell_escapes("echo \"plain text\""));
        // A backslash inside single quotes is literal, not an escape.
        assert!(!has_shell_escapes("echo 'a \\$b'"));
        assert!(has_shell_escapes("echo \"5 \\$US\""));
        assert!(has_shell_escapes("echo \"say \\\"hi\\\"\""));
        assert!(has_shell_escapes("echo a\\ b"));
        // The '\'' idiom used for single-quoted values.
        assert!(has_shell_escapes("echo 'it'\\''s'"));
    }

    #[test]
    fn test_is_quote_context_enabled_defaults_to_on() {
        // The opt-out is read from the environment on every call, so the
        // default (variable unset in the test process) must be enabled.
        if std::env::var("COMMAND_STREAM_QUOTE_CONTEXT").is_err() {
            assert!(is_quote_context_enabled());
        }
    }
}
