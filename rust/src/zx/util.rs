//! Small helpers shared by the zx-compatible API: quoting, duration parsing,
//! command assembly and name normalisation.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::error::ZxError;
use super::output::ProcessOutput;

/// Signature of the quoting function used to interpolate arguments.
pub type QuoteFn = fn(&str) -> String;

/// Returns `true` when `arg` only consists of characters that never need
/// quoting in a POSIX shell (letters, digits and `_/.-+@:=,%`).
pub fn is_safe_word(arg: &str) -> bool {
    !arg.is_empty()
        && arg.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '_' | '/' | '.' | '-' | '+' | '@' | ':' | '=' | ',' | '%')
        })
}

/// Quote a value for bash the way zx does.
///
/// * the empty string becomes `$''`;
/// * "safe" words are returned untouched;
/// * everything else is wrapped into an ANSI-C `$'...'` string where
///   backslashes, single quotes and control characters are escaped.
pub fn quote(arg: &str) -> String {
    if arg.is_empty() {
        return "$''".to_string();
    }
    if is_safe_word(arg) {
        return arg.to_string();
    }
    let mut out = String::with_capacity(arg.len() + 3);
    out.push_str("$'");
    for c in arg.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\u{0C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0B}' => out.push_str("\\v"),
            '\0' => out.push_str("\\0"),
            other => out.push(other),
        }
    }
    out.push('\'');
    out
}

/// Quote a value for PowerShell the way zx does: empty -> `''`, safe words
/// unchanged, otherwise single-quoted with embedded quotes doubled.
pub fn quote_powershell(arg: &str) -> String {
    if arg.is_empty() {
        return "''".to_string();
    }
    if is_safe_word(arg) {
        return arg.to_string();
    }
    format!("'{}'", arg.replace('\'', "''"))
}

/// Convert milliseconds into a [`Duration`], rejecting negative and NaN values.
pub fn duration_from_millis(ms: f64) -> Result<Duration, ZxError> {
    if ms.is_nan() || ms < 0.0 || ms.is_infinite() {
        return Err(ZxError::new(format!("Invalid duration: \"{ms}\".")));
    }
    Ok(Duration::from_secs_f64(ms / 1000.0))
}

/// Parse a zx duration string: `"100"` (ms), `"500ms"`, `"2s"` or `"2m"`.
pub fn parse_duration(input: &str) -> Result<Duration, ZxError> {
    let digits_end = input
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(input.len());
    let (digits, unit) = input.split_at(digits_end);
    let factor = match unit {
        "" | "ms" => 1u64,
        "s" => 1_000,
        "m" => 60_000,
        _ => return Err(ZxError::new(format!("Unknown duration: \"{input}\"."))),
    };
    if digits.is_empty() {
        return Err(ZxError::new(format!("Unknown duration: \"{input}\".")));
    }
    let value: u64 = digits
        .parse()
        .map_err(|_| ZxError::new(format!("Invalid duration: \"{input}\".")))?;
    Ok(Duration::from_millis(value.saturating_mul(factor)))
}

/// Convert `SOME_NAME` / `kebab-name` into `someName` / `kebabName`.
///
/// Mirrors zx: the input is lower-cased and every `[a-z][_-]+[a-z]` sequence
/// is collapsed with the right-hand letter upper-cased (non-overlapping).
pub fn to_camel_case(input: &str) -> String {
    let chars: Vec<char> = input.to_lowercase().chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_lowercase() {
            let mut j = i + 1;
            while j < chars.len() && matches!(chars[j], '_' | '-') {
                j += 1;
            }
            if j > i + 1 && j < chars.len() && chars[j].is_ascii_lowercase() {
                out.push(c);
                out.push(chars[j].to_ascii_uppercase());
                i = j + 1;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Parse `"true"` / `"false"`; any other value yields `None`.
pub fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// Platform `PATH` list separator.
pub const PATH_DELIMITER: &str = if cfg!(windows) { ";" } else { ":" };

/// Name of the `PATH` variable inside `env` (Windows keys are case-insensitive).
pub fn path_key<'a, I>(keys: I) -> String
where
    I: IntoIterator<Item = &'a String>,
{
    if cfg!(windows) {
        keys.into_iter()
            .find(|k| k.eq_ignore_ascii_case("path"))
            .cloned()
            .unwrap_or_else(|| "Path".to_string())
    } else {
        "PATH".to_string()
    }
}

fn absolutize(dir: &Path) -> PathBuf {
    if dir.is_absolute() {
        dir.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(dir))
            .unwrap_or_else(|_| dir.to_path_buf())
    }
}

/// Build a `PATH` value that prefers `<dir>/node_modules/.bin` and `<dir>`
/// for every directory in `dirs`, followed by the existing `path`.
pub fn prefer_local_bin<P: AsRef<Path>>(path: Option<&str>, dirs: &[P]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for dir in dirs {
        let dir = absolutize(dir.as_ref());
        parts.push(
            dir.join("node_modules")
                .join(".bin")
                .to_string_lossy()
                .into_owned(),
        );
        parts.push(dir.to_string_lossy().into_owned());
    }
    if let Some(path) = path {
        parts.push(path.to_string());
    }
    parts.join(PATH_DELIMITER)
}

/// Random lower-case alphanumeric identifier (used for temp names and ids).
pub fn random_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default(),
    );
    let mut n = hasher.finish();
    let alphabet = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = String::new();
    for _ in 0..10 {
        out.push(alphabet[(n % 36) as usize] as char);
        n /= 36;
    }
    out
}

/// A value interpolated into a command template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZxArg {
    /// A single word, quoted as a whole.
    One(String),
    /// A list of words, each quoted and joined with spaces.
    Many(Vec<String>),
}

impl ZxArg {
    /// Render the argument with the given quoting function.
    pub fn render(&self, quote_fn: QuoteFn) -> String {
        match self {
            ZxArg::One(s) => quote_fn(s),
            ZxArg::Many(items) => items
                .iter()
                .map(|s| quote_fn(s))
                .collect::<Vec<_>>()
                .join(" "),
        }
    }

    fn into_words(self) -> Vec<String> {
        match self {
            ZxArg::One(s) => vec![s],
            ZxArg::Many(v) => v,
        }
    }
}

/// Conversion of Rust values into command template arguments.
///
/// Strings, numbers, booleans and paths become a single word; a
/// [`ProcessOutput`] contributes its stdout without the trailing newline;
/// vectors, slices and arrays expand to several words.
pub trait IntoZxArg {
    /// Perform the conversion.
    fn into_zx_arg(self) -> ZxArg;
}

impl IntoZxArg for ZxArg {
    fn into_zx_arg(self) -> ZxArg {
        self
    }
}

macro_rules! display_args {
    ($($t:ty),* $(,)?) => {
        $(
            impl IntoZxArg for $t {
                fn into_zx_arg(self) -> ZxArg {
                    ZxArg::One(self.to_string())
                }
            }
            impl IntoZxArg for &$t {
                fn into_zx_arg(self) -> ZxArg {
                    ZxArg::One(self.to_string())
                }
            }
        )*
    };
}

display_args!(
    String, char, bool, i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, f32, f64
);

impl IntoZxArg for &str {
    fn into_zx_arg(self) -> ZxArg {
        ZxArg::One(self.to_string())
    }
}

impl IntoZxArg for &&str {
    fn into_zx_arg(self) -> ZxArg {
        ZxArg::One((*self).to_string())
    }
}

impl IntoZxArg for &Path {
    fn into_zx_arg(self) -> ZxArg {
        ZxArg::One(self.to_string_lossy().into_owned())
    }
}

impl IntoZxArg for PathBuf {
    fn into_zx_arg(self) -> ZxArg {
        ZxArg::One(self.to_string_lossy().into_owned())
    }
}

impl IntoZxArg for &PathBuf {
    fn into_zx_arg(self) -> ZxArg {
        ZxArg::One(self.to_string_lossy().into_owned())
    }
}

impl IntoZxArg for &ProcessOutput {
    fn into_zx_arg(self) -> ZxArg {
        let out = self.stdout.strip_suffix('\n').unwrap_or(&self.stdout);
        ZxArg::One(out.to_string())
    }
}

impl IntoZxArg for ProcessOutput {
    fn into_zx_arg(self) -> ZxArg {
        (&self).into_zx_arg()
    }
}

impl<T: IntoZxArg> IntoZxArg for Vec<T> {
    fn into_zx_arg(self) -> ZxArg {
        ZxArg::Many(
            self.into_iter()
                .flat_map(|item| item.into_zx_arg().into_words())
                .collect(),
        )
    }
}

impl<T: IntoZxArg + Clone> IntoZxArg for &Vec<T> {
    fn into_zx_arg(self) -> ZxArg {
        self.as_slice().into_zx_arg()
    }
}

impl<T: IntoZxArg + Clone> IntoZxArg for &[T] {
    fn into_zx_arg(self) -> ZxArg {
        self.to_vec().into_zx_arg()
    }
}

impl<T: IntoZxArg, const N: usize> IntoZxArg for [T; N] {
    fn into_zx_arg(self) -> ZxArg {
        Vec::from(self).into_zx_arg()
    }
}

/// Convert any supported value into a [`ZxArg`].
pub fn zx_arg<T: IntoZxArg>(value: T) -> ZxArg {
    value.into_zx_arg()
}

/// Interleave template `pieces` with quoted `args`.
///
/// `pieces` must contain exactly one more element than `args`.
pub fn build_cmd(quote_fn: QuoteFn, pieces: &[&str], args: &[ZxArg]) -> Result<String, ZxError> {
    if pieces.len() != args.len() + 1 {
        return Err(ZxError::new(format!(
            "Malformed command: {} template pieces for {} arguments",
            pieces.len(),
            args.len()
        )));
    }
    let mut cmd = pieces[0].to_string();
    for (arg, piece) in args.iter().zip(&pieces[1..]) {
        cmd.push_str(&arg.render(quote_fn));
        cmd.push_str(piece);
    }
    Ok(cmd)
}

/// Split a `zx!` format string on `{}` placeholders (`{{}}` is a literal `{}`).
pub fn split_template(template: &str) -> Vec<String> {
    let mut pieces = vec![String::new()];
    let mut rest = template;
    while !rest.is_empty() {
        if let Some(tail) = rest.strip_prefix("{{}}") {
            pieces.last_mut().unwrap().push_str("{}");
            rest = tail;
        } else if let Some(tail) = rest.strip_prefix("{}") {
            pieces.push(String::new());
            rest = tail;
        } else {
            let c = rest.chars().next().unwrap();
            pieces.last_mut().unwrap().push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    pieces
}
