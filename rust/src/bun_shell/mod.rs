//! A portable implementation of Bun Shell (`Bun.$`), ported from Bun's
//! `src/runtime/shell` and `src/shell_parser` and kept behaviour-identical
//! with the JavaScript port in `js/src/bun-shell/`.
//!
//! Scripts are written as template literals: `strings` are the raw template
//! parts and `values` the interpolated values between them, exactly like
//! `` $`echo ${name} | cat` `` in JavaScript:
//!
//! ```rust,no_run
//! use command_stream::bun_shell::{shell, ShellValue};
//!
//! # async fn demo() -> Result<(), command_stream::bun_shell::ShellError> {
//! let out = shell(&["echo ", " | cat"], vec![ShellValue::from("world")])?
//!     .quiet()
//!     .run()
//!     .await?;
//! assert_eq!(out.text(), "world\n");
//! # Ok(())
//! # }
//! ```
//!
//! The conformance corpus in `conformance/bun-shell/` is the specification;
//! `rust/tests/bun_shell_conformance.rs` runs it against this module.

pub(crate) mod builtin;
pub(crate) mod builtins;
pub(crate) mod env;
pub(crate) mod errno;
pub(crate) mod io;
pub(crate) mod node_path;
pub(crate) mod subprocess;

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

mod braces;
mod expansion;
pub(crate) mod glob;
mod interpreter;
mod lexer;
mod parser;
mod template;

pub use braces::BraceError;

/// `$.braces(pattern)`: expand a brace pattern into words, e.g.
/// `"echo {a,b}"` into `["echo a", "echo b"]`.
pub fn braces(pattern: &str) -> Result<Vec<String>, BraceError> {
    braces::braces(pattern)
}

/// `$.escape(s)`: escape a string for use in a script, quoting it when it
/// contains special characters.
pub fn escape(s: &str) -> String {
    template::shell_escape(s)
}

/// A fixed-size byte buffer that receives output (`> ${buf}` in JavaScript,
/// where `buf` is a `Uint8Array`). Output beyond its size is dropped.
#[derive(Clone, Debug)]
pub struct OutBuffer(Arc<Mutex<Vec<u8>>>);

impl OutBuffer {
    /// A zero-filled buffer of `size` bytes.
    pub fn new(size: usize) -> Self {
        Self(Arc::new(Mutex::new(vec![0; size])))
    }

    /// A copy of the current contents (always `size` bytes long).
    pub fn contents(&self) -> Vec<u8> {
        self.0.lock().map(|b| b.clone()).unwrap_or_default()
    }

    /// Run `f` with mutable access to the underlying bytes.
    pub fn with<R>(&self, f: impl FnOnce(&mut [u8]) -> R) -> R {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        f(guard.as_mut_slice())
    }

    /// Whether both handles refer to the same buffer.
    pub fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

/// An interpolated template value (the JavaScript value kinds that Bun Shell
/// accepts, minus the JS-only `Response`/`Blob`/`Bun.file` objects).
#[derive(Clone, Debug)]
pub enum ShellValue {
    /// A string; it is escaped (quoted) when it contains special characters.
    Str(String),
    /// `{ raw: "..." }`: spliced into the script source unescaped.
    Raw(String),
    /// A JS number (stringified like JavaScript's `String(n)`).
    Number(f64),
    /// A JS bigint, given as its decimal digits.
    BigInt(String),
    Bool(bool),
    Null,
    Undefined,
    /// An array: each element becomes a separate word (nested arrays flatten).
    Array(Vec<ShellValue>),
    /// A byte buffer used as input (`< ${bytes}`).
    Bytes(Vec<u8>),
    /// An output buffer (`> ${buf}`).
    OutBuffer(OutBuffer),
}

impl From<&str> for ShellValue {
    fn from(s: &str) -> Self {
        Self::Str(s.to_string())
    }
}

impl From<String> for ShellValue {
    fn from(s: String) -> Self {
        Self::Str(s)
    }
}

impl From<&String> for ShellValue {
    fn from(s: &String) -> Self {
        Self::Str(s.clone())
    }
}

impl From<&std::path::Path> for ShellValue {
    fn from(p: &std::path::Path) -> Self {
        Self::Str(p.to_string_lossy().into_owned())
    }
}

impl From<PathBuf> for ShellValue {
    fn from(p: PathBuf) -> Self {
        Self::Str(p.to_string_lossy().into_owned())
    }
}

impl From<bool> for ShellValue {
    fn from(b: bool) -> Self {
        Self::Bool(b)
    }
}

macro_rules! number_from {
    ($($t:ty),*) => {
        $(impl From<$t> for ShellValue {
            fn from(n: $t) -> Self {
                Self::Number(n as f64)
            }
        })*
    };
}
number_from!(i8, i16, i32, i64, u8, u16, u32, u64, usize, isize, f32, f64);

impl<T: Into<ShellValue>> From<Vec<T>> for ShellValue {
    fn from(v: Vec<T>) -> Self {
        Self::Array(v.into_iter().map(Into::into).collect())
    }
}

impl From<OutBuffer> for ShellValue {
    fn from(b: OutBuffer) -> Self {
        Self::OutBuffer(b)
    }
}

/// The result of a finished script (Bun's `ShellOutput`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShellOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: i32,
}

impl ShellOutput {
    /// stdout decoded as UTF-8 (lossy).
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    /// stdout parsed as JSON.
    pub fn json(&self) -> Result<serde_json::Value, serde_json::Error> {
        serde_json::from_slice(&self.stdout)
    }

    /// stdout split on `\n` (like Bun's `.lines()`, the last piece included).
    pub fn lines(&self) -> Vec<String> {
        self.text().split('\n').map(str::to_string).collect()
    }
}

/// What kind of failure a [`ShellError`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellErrorKind {
    /// The script (or an interpolated value) was rejected before running;
    /// the equivalent of the JavaScript `$` call throwing synchronously.
    Parse,
    /// The script exited with a non-zero code in throwing mode (Bun's
    /// `ShellError`); `output` holds its stdout/stderr/exit code.
    Exit,
    /// A system error while starting or running the script (e.g. the `cwd`
    /// does not exist).
    System,
}

/// A failed shell invocation.
#[derive(Clone, Debug)]
pub struct ShellError {
    pub kind: ShellErrorKind,
    /// The same message the JavaScript implementation throws.
    pub message: String,
    /// Set for [`ShellErrorKind::Exit`].
    pub output: Option<ShellOutput>,
}

impl ShellError {
    pub fn parse(message: impl Into<String>) -> Self {
        Self {
            kind: ShellErrorKind::Parse,
            message: message.into(),
            output: None,
        }
    }

    pub fn system(message: impl Into<String>) -> Self {
        Self {
            kind: ShellErrorKind::System,
            message: message.into(),
            output: None,
        }
    }

    pub fn exit(output: ShellOutput) -> Self {
        Self {
            kind: ShellErrorKind::Exit,
            message: format!("Failed with exit code {}", output.exit_code),
            output: Some(output),
        }
    }

    pub fn exit_code(&self) -> Option<i32> {
        self.output.as_ref().map(|o| o.exit_code)
    }
}

impl fmt::Display for ShellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ShellError {}

/// Default settings for new commands (Bun's `new $.Shell()`): each `Shell`
/// has its own cwd, env and throwing mode.
#[derive(Clone, Debug)]
pub struct Shell {
    cwd: Option<PathBuf>,
    env: Option<HashMap<String, String>>,
    throws: bool,
}

impl Default for Shell {
    fn default() -> Self {
        Self::new()
    }
}

impl Shell {
    pub fn new() -> Self {
        Self {
            cwd: None,
            env: None,
            throws: true,
        }
    }

    /// Default working directory (`None`: the process cwd).
    pub fn cwd(&mut self, cwd: Option<impl Into<PathBuf>>) -> &mut Self {
        self.cwd = cwd.map(Into::into);
        self
    }

    /// Default environment (`None`: the process environment).
    pub fn env(&mut self, env: Option<HashMap<String, String>>) -> &mut Self {
        self.env = env;
        self
    }

    pub fn nothrow(&mut self) -> &mut Self {
        self.throws = false;
        self
    }

    pub fn throws(&mut self, throws: bool) -> &mut Self {
        self.throws = throws;
        self
    }

    /// Parse a template into a runnable command. Parse errors (and invalid
    /// values) are returned here, like the JavaScript `$` call throwing.
    pub fn command(
        &self,
        strings: &[&str],
        values: Vec<ShellValue>,
    ) -> Result<ShellCommand, ShellError> {
        let mut cmd = ShellCommand::parse(strings, values)?;
        cmd.throws = self.throws;
        if let Some(cwd) = &self.cwd {
            cmd = cmd.cwd(cwd.clone());
        }
        if let Some(env) = &self.env {
            cmd = cmd.env(env.clone());
        }
        Ok(cmd)
    }
}

/// Parse a template with the default [`Shell`] settings (Bun's `$`).
pub fn shell(strings: &[&str], values: Vec<ShellValue>) -> Result<ShellCommand, ShellError> {
    Shell::new().command(strings, values)
}

/// A parsed script plus its settings (Bun's `ShellPromise`). Nothing runs
/// until [`ShellCommand::run`] is awaited.
pub struct ShellCommand {
    script: ParsedScript,
    cwd: Option<PathBuf>,
    env: HashMap<String, String>,
    quiet: bool,
    throws: bool,
}

// Environment values often hold secrets (tokens, auth headers), so `Debug`
// prints only the variable names.
impl fmt::Debug for ShellCommand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut env: Vec<&str> = self.env.keys().map(String::as_str).collect();
        env.sort_unstable();
        f.debug_struct("ShellCommand")
            .field("script", &self.script)
            .field("cwd", &self.cwd)
            .field("env", &env)
            .field("quiet", &self.quiet)
            .field("throws", &self.throws)
            .finish()
    }
}

/// The parsed form of a template.
#[derive(Debug)]
pub(crate) struct ParsedScript {
    pub(crate) ast: parser::Script,
    /// Strings referenced by `\x08__bunstr_N\x08` placeholders (already
    /// substituted into the AST by the parser; kept for inspection).
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) jsstrings: Vec<String>,
    /// Values referenced by `\x08__bun_N\x08` placeholders (buffers).
    pub(crate) jsobjs: Vec<ShellValue>,
}

impl ShellCommand {
    fn parse(strings: &[&str], values: Vec<ShellValue>) -> Result<Self, ShellError> {
        let src = template::build_shell_source(strings, values).map_err(ShellError::parse)?;
        let ast = parser::parse(&src.script, &src.jsstrings, src.jsobjs.len())
            .map_err(ShellError::parse)?;
        Ok(Self {
            script: ParsedScript {
                ast,
                jsstrings: src.jsstrings,
                jsobjs: src.jsobjs,
            },
            cwd: None,
            env: std::env::vars().collect(),
            quiet: false,
            throws: true,
        })
    }

    /// Working directory (`""`, `"."` and `"./"` mean the process cwd).
    pub fn cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        let cwd = cwd.into();
        let s = cwd.to_string_lossy();
        self.cwd = if s.is_empty() || s == "." || s == "./" {
            std::env::current_dir().ok()
        } else {
            Some(cwd)
        };
        self
    }

    /// Replace the environment (Bun's `.env({...})`).
    pub fn env(mut self, env: HashMap<String, String>) -> Self {
        self.env = env;
        self
    }

    /// Capture output only, without echoing it to the process stdout/stderr.
    pub fn quiet(mut self) -> Self {
        self.quiet = true;
        self
    }

    /// Resolve with the output even when the exit code is non-zero.
    pub fn nothrow(mut self) -> Self {
        self.throws = false;
        self
    }

    pub fn throws(mut self, throws: bool) -> Self {
        self.throws = throws;
        self
    }

    /// Run the script to completion.
    pub async fn run(self) -> Result<ShellOutput, ShellError> {
        // Sorted, so the child environment does not depend on hash order.
        let mut env: Vec<(String, String)> = self.env.into_iter().collect();
        env.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let (interp, mut root) = interpreter::Interpreter::new(interpreter::InterpreterOptions {
            jsobjs: self.script.jsobjs,
            env: env.into_iter().collect(),
            cwd: self.cwd.map(|p| p.to_string_lossy().into_owned()),
            quiet: self.quiet,
            argv: std::env::args().collect(),
        })?;
        let out = interp.run(&self.script.ast, &mut root).await?;
        let output = ShellOutput {
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        };
        if self.throws && output.exit_code != 0 {
            return Err(ShellError::exit(output));
        }
        Ok(output)
    }

    /// Run quietly and return stdout as text.
    pub async fn text(self) -> Result<String, ShellError> {
        Ok(self.quiet().run().await?.text())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_error(strings: &[&str], values: Vec<ShellValue>) -> ShellError {
        match shell(strings, values) {
            Ok(_) => panic!("expected a parse error for {strings:?}"),
            Err(e) => e,
        }
    }

    #[test]
    fn frontend_errors_are_parse_errors_with_the_js_message() {
        let e = parse_error(&["echo ("], vec![]);
        assert_eq!(e.kind, ShellErrorKind::Parse);
        assert_eq!(e.message, "Unclosed subshell");
        let e = parse_error(&["echo $(echo"], vec![]);
        assert_eq!(e.message, "Unclosed command substitution");
        let e = parse_error(&["echo hi &"], vec![]);
        assert_eq!(
            e.message,
            "Background commands \"&\" are not supported yet."
        );
        let e = parse_error(&["echo ", ""], vec![ShellValue::Str("a\0b".into())]);
        assert_eq!(e.kind, ShellErrorKind::Parse);
    }

    #[test]
    fn debug_shows_env_names_but_not_values() {
        let env = HashMap::from([("TOKEN".to_string(), "s3cret".to_string())]);
        let cmd = shell(&["echo hi"], vec![]).unwrap().env(env);
        let debug = format!("{cmd:?}");
        assert!(debug.contains("TOKEN"), "{debug}");
        assert!(!debug.contains("s3cret"), "{debug}");
    }

    #[test]
    fn parse_keeps_interpolated_strings_and_objects() {
        let cmd = shell(
            &["cat ", " < ", ""],
            vec![ShellValue::from("a b"), ShellValue::Bytes(b"x".to_vec())],
        )
        .unwrap();
        assert_eq!(cmd.script.jsstrings, ["a b"]);
        assert_eq!(cmd.script.jsobjs.len(), 1);
        assert_eq!(cmd.script.ast.stmts.len(), 1);
    }

    #[test]
    fn braces_and_escape() {
        assert_eq!(braces("x{a,b}").unwrap(), ["xa", "xb"]);
        assert_eq!(
            braces(&"{a,b}".repeat(17)).unwrap_err(),
            BraceError::TooManyExpansions(131072)
        );
        assert_eq!(escape("a b"), "\"a b\"");
        assert_eq!(escape("ab"), "ab");
    }
}
