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

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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
#[derive(Debug)]
pub struct ShellCommand {
    script: ParsedScript,
    cwd: Option<PathBuf>,
    env: HashMap<String, String>,
    quiet: bool,
    throws: bool,
}

/// The parsed form of a template (filled in by the parser port).
#[derive(Debug)]
struct ParsedScript {
    source: Vec<String>,
    values: Vec<ShellValue>,
}

impl ShellCommand {
    fn parse(strings: &[&str], values: Vec<ShellValue>) -> Result<Self, ShellError> {
        Ok(Self {
            script: ParsedScript {
                source: strings.iter().map(|s| s.to_string()).collect(),
                values,
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
        let _ = (&self.script.source, &self.script.values, self.quiet);
        Err(ShellError::system(
            "bun_shell: interpreter not implemented yet",
        ))
    }

    /// Run quietly and return stdout as text.
    pub async fn text(self) -> Result<String, ShellError> {
        Ok(self.quiet().run().await?.text())
    }
}
