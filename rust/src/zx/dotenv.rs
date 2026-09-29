//! `.env` parsing and serialization (the `dotenv` helpers zx re-exports).

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::Path;

use super::error::ZxError;

const QUOTES: [&str; 3] = ["\"", "'", "`"];
const TRIPLE_QUOTES: [&str; 3] = ["\"\"\"", "'''", "```"];

/// First unescaped `quote` in `text` (backslash escapes except inside `'`).
fn find_closing_quote(text: &str, quote: char) -> Option<usize> {
    let mut chars = text.char_indices();
    while let Some((i, c)) = chars.next() {
        if c == '\\' && quote != '\'' {
            chars.next();
        } else if c == quote {
            return Some(i);
        }
    }
    None
}

fn strip_inline_comment(value: &str) -> &str {
    let cut = value
        .match_indices('#')
        .map(|(i, _)| i)
        .find(|&i| i == 0 || value[..i].ends_with(char::is_whitespace));
    // `(^|\s)#`: the whitespace before `#` is removed by the trim below.
    match cut {
        Some(i) => value[..i].trim(),
        None => value.trim(),
    }
}

/// Read a value that may span lines; `closer` finds the closing delimiter.
fn read_quoted(
    lines: &[&str],
    start: usize,
    first: &str,
    closer: impl Fn(&str) -> Option<usize>,
) -> (String, usize) {
    if let Some(end) = closer(first) {
        return (first[..end].to_string(), start + 1);
    }
    let mut parts: Vec<&str> = if first.is_empty() {
        vec![]
    } else {
        vec![first]
    };
    for (i, line) in lines.iter().enumerate().skip(start + 1) {
        if let Some(end) = closer(line) {
            let tail = &line[..end];
            if !tail.trim().is_empty() || parts.is_empty() {
                parts.push(tail);
            }
            return (parts.join("\n"), i + 1);
        }
        parts.push(line);
    }
    (first.to_string(), start + 1)
}

fn read_value(lines: &[&str], index: usize, raw: &str) -> (String, usize) {
    if let Some(triple) = TRIPLE_QUOTES.iter().find(|q| raw.starts_with(*q)) {
        return read_quoted(lines, index, &raw[3..], |line| line.find(triple));
    }
    if let Some(quote) = QUOTES.iter().find(|q| raw.starts_with(*q)) {
        let q = quote.chars().next().expect("non-empty quote");
        return read_quoted(lines, index, &raw[1..], |line| find_closing_quote(line, q));
    }
    (strip_inline_comment(raw).to_string(), index + 1)
}

/// Parse dotenv text into key/value pairs (later keys overwrite earlier ones).
pub fn parse(content: &str) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    let lines: Vec<&str> = content
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    let mut index = 0;
    while index < lines.len() {
        let trimmed = lines[index].trim();
        let line = strip_export(trimmed);
        let key = match line.find('=') {
            Some(eq) if eq > 0 => line[..eq].trim(),
            _ => "",
        };
        if line.starts_with('#') || key.is_empty() || key.contains(char::is_whitespace) {
            index += 1;
            continue;
        }
        let eq = line.find('=').expect("key implies '='");
        let (value, next) = read_value(&lines, index, line[eq + 1..].trim());
        result.insert(key.to_string(), value);
        index = next;
    }
    result
}

fn strip_export(line: &str) -> &str {
    if let Some(rest) = line.strip_prefix("export") {
        if rest.starts_with(char::is_whitespace) {
            return rest.trim_start();
        }
    }
    line
}

fn quote_value(value: &str) -> String {
    let needs_quotes = value
        .chars()
        .any(|c| c.is_whitespace() || matches!(c, '#' | '\'' | '"' | '`'));
    if !needs_quotes {
        return value.to_string();
    }
    if !value.contains(['\r', '\n']) {
        if !value.contains('\'') {
            return format!("'{value}'");
        }
        if !value.contains('\\') {
            if let Some(q) = QUOTES.iter().find(|q| !value.contains(*q)) {
                return format!("{q}{value}{q}");
            }
        }
    }
    let triple = TRIPLE_QUOTES
        .iter()
        .find(|q| !value.contains(*q))
        .unwrap_or(&TRIPLE_QUOTES[0]);
    format!("{triple}\n{value}\n{triple}")
}

/// Serialize pairs as dotenv text, one `KEY=value` per line, quoting values
/// so that [`parse`] reads them back unchanged.
pub fn stringify<'a, I, K, V>(env: I) -> String
where
    I: IntoIterator<Item = (&'a K, &'a V)>,
    K: AsRef<str> + ?Sized + 'a,
    V: AsRef<str> + ?Sized + 'a,
{
    env.into_iter()
        .map(|(k, v)| format!("{}={}", k.as_ref(), quote_value(v.as_ref())))
        .collect::<Vec<_>>()
        .join("\n")
}

fn read_file(file: &Path) -> Result<BTreeMap<String, String>, ZxError> {
    let text = std::fs::read_to_string(file)?;
    Ok(parse(&text))
}

/// Read and merge env files; earlier files take precedence.
pub fn load<P: AsRef<Path>>(files: &[P]) -> Result<BTreeMap<String, String>, ZxError> {
    let mut env = BTreeMap::new();
    for file in files {
        for (k, v) in read_file(file.as_ref())? {
            env.entry(k).or_insert(v);
        }
    }
    Ok(env)
}

/// Like [`load`], but skips files that cannot be read.
pub fn load_safe<P: AsRef<Path>>(files: &[P]) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for file in files {
        if let Ok(parsed) = read_file(file.as_ref()) {
            for (k, v) in parsed {
                env.entry(k).or_insert(v);
            }
        }
    }
    env
}

/// Load env files into a map suitable for [`Shell::env`](super::Shell::env):
/// the current process environment overlaid (without overriding) by the file
/// values. Unlike zx this never mutates the process environment.
pub fn config<P: AsRef<Path>>(files: &[P]) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    for (k, v) in load_safe(files) {
        env.entry(k).or_insert(v);
    }
    env
}
