//! Tagged template → shell source, ported from Bun's `shell_cmd_from_js` /
//! `handle_template_value` / `ShellSrcBuilder`
//! (`src/runtime/shell/shell_body.rs`) and `escape_*`
//! (`src/shell_parser/parse.rs`), via `js/src/bun-shell/template.mjs`.
//!
//! Interpolated strings that need quoting are not spliced into the source;
//! they are replaced by `\x08__bunstr_N\x08` references resolved by the lexer,
//! and objects (byte buffers) by `\x08__bun_N\x08`.

use super::lexer::{LEX_JS_OBJREF_PREFIX, LEX_JS_STRING_PREFIX, SPECIAL_JS_CHAR};
use super::ShellValue;

const MAX_TEMPLATE_ARRAY_DEPTH: usize = 100;
const IF_CLAUSE_KEYWORDS: [&str; 5] = ["if", "else", "elif", "then", "fi"];

/// The script source assembled from a template, plus the values it refers to.
#[derive(Debug)]
pub(crate) struct ShellSource {
    /// Shell source with `\x08__bunstr_N\x08` / `\x08__bun_N\x08` references.
    pub script: String,
    /// Interpolated strings referenced as `__bunstr_N`.
    pub jsstrings: Vec<String>,
    /// Interpolated objects ([`ShellValue::Bytes`] / [`ShellValue::OutBuffer`])
    /// referenced as `__bun_N`.
    pub jsobjs: Vec<ShellValue>,
}

/// Characters that force an interpolated string to be passed by reference
/// (`SPECIAL_CHARS` in `parse.rs`).
pub(crate) fn is_special_char(c: char) -> bool {
    matches!(
        c,
        '~' | '['
            | ']'
            | '#'
            | ';'
            | '\n'
            | '\t'
            | '\r'
            | '*'
            | '?'
            | '{'
            | ','
            | '}'
            | '`'
            | '$'
            | '='
            | '('
            | ')'
            | '0'..='9' | '|' | '>' | '<' | '&' | '\'' | '"' | ' ' | '\\' | SPECIAL_JS_CHAR
    )
}

/// Whether an interpolated string must be passed by reference (quoted).
pub(crate) fn needs_escape(s: &str) -> bool {
    s.is_empty() || s.chars().any(is_special_char)
}

/// Bun's `escape_*::<ADD_QUOTES>`: backslash `` $ ` " \ `` and neutralise
/// `\x08`.
pub(crate) fn escape_shell_string(s: &str, add_quotes: bool) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    if add_quotes {
        out.push('"');
    }
    for ch in s.chars() {
        match ch {
            '$' | '`' | '"' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            SPECIAL_JS_CHAR => {
                out.push(SPECIAL_JS_CHAR);
                out.push_str("\"\"");
            }
            _ => out.push(ch),
        }
    }
    if add_quotes {
        out.push('"');
    }
    out
}

/// `$.escape(value)`: quote a string for safe use inside a shell script.
pub(crate) fn shell_escape(s: &str) -> String {
    if needs_escape(s) {
        escape_shell_string(s, true)
    } else {
        s.to_string()
    }
}

/// JavaScript's `String(n)` for a number (`Number::toString(10)`).
pub(crate) fn js_number_to_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_string();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if n == 0.0 {
        return "0".to_string();
    }
    if n < 0.0 {
        return format!("-{}", js_number_to_string(-n));
    }
    // `{:e}` yields the shortest round-tripping digits, e.g. `1.5e-7`.
    let sci = format!("{n:e}");
    let (mantissa, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i64;
    let point = exp.parse::<i64>().unwrap_or(0) + 1;
    if k <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - k) as usize))
    } else if 0 < point && point <= 21 {
        let (int, frac) = digits.split_at(point as usize);
        format!("{int}.{frac}")
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let e = point - 1;
        let sign = if e < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        if rest.is_empty() {
            format!("{first}e{sign}{}", e.abs())
        } else {
            format!("{first}.{rest}e{sign}{}", e.abs())
        }
    }
}

fn null_byte_error(s: &str) -> String {
    format!("The shell argument must be a string without null bytes. Received \"{s}\"")
}

#[derive(Default)]
struct Builder {
    script: String,
    jsstrings: Vec<String>,
    jsobjs: Vec<ShellValue>,
}

impl Builder {
    fn ends_with_var_ref(&self) -> bool {
        self.script
            .chars()
            .rev()
            .find(|c| !(c.is_ascii_alphanumeric() || *c == '_'))
            .is_some_and(|c| c == '$')
    }

    fn append_value_str(&mut self, s: &str, allow_escape: bool) -> Result<(), String> {
        if s.contains('\0') {
            return Err(null_byte_error(s));
        }
        self.append_str(s, allow_escape);
        Ok(())
    }

    fn append_str(&mut self, s: &str, allow_escape: bool) {
        if allow_escape
            && (needs_escape(s) || IF_CLAUSE_KEYWORDS.contains(&s) || self.ends_with_var_ref())
        {
            self.script.push_str(LEX_JS_STRING_PREFIX);
            self.script.push_str(&self.jsstrings.len().to_string());
            self.script.push(SPECIAL_JS_CHAR);
            self.jsstrings.push(s.to_string());
            return;
        }
        self.script.push_str(s);
    }

    fn append_obj_ref(&mut self, value: ShellValue) {
        self.script.push_str(LEX_JS_OBJREF_PREFIX);
        self.script.push_str(&self.jsobjs.len().to_string());
        self.script.push(SPECIAL_JS_CHAR);
        self.jsobjs.push(value);
    }

    fn append_value(&mut self, value: ShellValue, depth: usize) -> Result<(), String> {
        match value {
            ShellValue::Str(s) => self.append_value_str(&s, true),
            ShellValue::Number(n) => self.append_value_str(&js_number_to_string(n), true),
            ShellValue::BigInt(digits) => self.append_value_str(&digits, true),
            ShellValue::Bool(b) => self.append_value_str(if b { "true" } else { "false" }, true),
            ShellValue::Null => self.append_value_str("null", true),
            ShellValue::Undefined => self.append_value_str("undefined", true),
            ShellValue::Raw(s) => self.append_value_str(&s, false),
            ShellValue::Array(items) => self.append_array(items, depth),
            value @ (ShellValue::Bytes(_) | ShellValue::OutBuffer(_)) => {
                self.append_obj_ref(value);
                Ok(())
            }
        }
    }

    fn append_array(&mut self, items: Vec<ShellValue>, depth: usize) -> Result<(), String> {
        if depth >= MAX_TEMPLATE_ARRAY_DEPTH {
            return Err(format!(
                "Shell script template arrays cannot be nested more than {MAX_TEMPLATE_ARRAY_DEPTH} levels deep"
            ));
        }
        let last = items.len().saturating_sub(1);
        for (i, item) in items.into_iter().enumerate() {
            self.append_value(item, depth + 1)?;
            if i < last {
                self.script.push(' ');
            }
        }
        Ok(())
    }
}

/// Build shell source from tagged-template parts: `strings` are the raw
/// template strings and `values` the interpolated values between them.
/// Errors carry the exact message the JavaScript port throws.
pub(crate) fn build_shell_source(
    strings: &[&str],
    values: Vec<ShellValue>,
) -> Result<ShellSource, String> {
    let mut builder = Builder::default();
    let last = strings.len().saturating_sub(1);
    let mut values = values.into_iter();
    for (i, s) in strings.iter().enumerate() {
        builder.append_value_str(s, false)?;
        if i < last {
            let value = values
                .next()
                .ok_or_else(|| "Shell script is missing JSValue arg".to_string())?;
            builder.append_value(value, 0)?;
        }
    }
    Ok(ShellSource {
        script: builder.script,
        jsstrings: builder.jsstrings,
        jsobjs: builder.jsobjs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bun_shell::OutBuffer;

    fn build(strings: &[&str], values: Vec<ShellValue>) -> ShellSource {
        build_shell_source(strings, values).unwrap()
    }

    #[test]
    fn numbers_format_like_javascript() {
        let cases: [(f64, &str); 16] = [
            (1.0, "1"),
            (1.5, "1.5"),
            (-0.0, "0"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (123456789012345680000.0, "123456789012345680000"),
            (0.1, "0.1"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (-42.25, "-42.25"),
            (2.5e300, "2.5e+300"),
            (0.1 + 0.2, "0.30000000000000004"),
        ];
        for (n, want) in cases {
            assert_eq!(js_number_to_string(n), want, "{n}");
        }
    }

    #[test]
    fn plain_strings_are_spliced() {
        let src = build(&["echo ", ""], vec!["hello".into()]);
        assert_eq!(src.script, "echo hello");
        assert!(src.jsstrings.is_empty());
    }

    #[test]
    fn special_strings_become_references() {
        let src = build(&["echo ", " ", ""], vec!["a b".into(), "".into()]);
        assert_eq!(src.script, "echo \x08__bunstr_0\x08 \x08__bunstr_1\x08");
        assert_eq!(src.jsstrings, vec!["a b".to_string(), String::new()]);
        let src = build(&["echo ", ""], vec!["fi".into()]);
        assert_eq!(src.jsstrings, vec!["fi".to_string()]);
        let src = build(&["echo $", ""], vec!["x".into()]);
        assert_eq!(src.jsstrings, vec!["x".to_string()]);
    }

    #[test]
    fn values_of_every_kind() {
        let buf = OutBuffer::new(4);
        let src = build(
            &["echo ", " ", " ", " ", " ", " ", " > ", ""],
            vec![
                ShellValue::Raw("$HOME | cat".into()),
                ShellValue::Array(vec!["a".into(), ShellValue::Array(vec!["b c".into()])]),
                ShellValue::Bool(true),
                ShellValue::Null,
                ShellValue::Undefined,
                ShellValue::BigInt("12".into()),
                buf.into(),
            ],
        );
        assert_eq!(
            src.script,
            "echo $HOME | cat a \x08__bunstr_0\x08 true null undefined \x08__bunstr_1\x08 > \x08__bun_0\x08"
        );
        assert_eq!(src.jsstrings, vec!["b c".to_string(), "12".to_string()]);
        assert_eq!(src.jsobjs.len(), 1);
    }

    #[test]
    fn errors() {
        let err = build_shell_source(&["echo ", ""], vec!["a\0b".into()]).unwrap_err();
        assert_eq!(
            err,
            "The shell argument must be a string without null bytes. Received \"a\0b\""
        );
        let err = build_shell_source(&["echo ", " ", ""], vec!["a".into()]).unwrap_err();
        assert_eq!(err, "Shell script is missing JSValue arg");
        let mut deep = ShellValue::Array(vec![]);
        for _ in 0..101 {
            deep = ShellValue::Array(vec![deep]);
        }
        let err = build_shell_source(&["echo ", ""], vec![deep]).unwrap_err();
        assert_eq!(
            err,
            "Shell script template arrays cannot be nested more than 100 levels deep"
        );
    }

    #[test]
    fn escape() {
        assert_eq!(shell_escape("abc"), "abc");
        assert_eq!(shell_escape("a b"), "\"a b\"");
        assert_eq!(shell_escape("$x`\"\\"), "\"\\$x\\`\\\"\\\\\"");
        assert_eq!(shell_escape(""), "\"\"");
    }
}
