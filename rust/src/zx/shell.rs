//! The [`Shell`] builder (zx `$`), its options and the scoped defaults used by
//! [`within`], [`configure`] and [`cd`].

use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;

use once_cell::sync::Lazy;

use super::error::ZxError;
use super::kill::SIGTERM;
use super::process::ProcessPromise;
use super::util::{
    build_cmd, parse_bool, parse_duration, quote, quote_powershell, to_camel_case, QuoteFn, ZxArg,
};

/// Prefix used by bash so that failures inside pipelines are not hidden.
pub const BASH_PREFIX: &str = "set -euo pipefail;";
/// Postfix used by PowerShell so that the exit code is propagated.
pub const POWERSHELL_POSTFIX: &str = "; exit $LastExitCode";

/// Which directories get their `node_modules/.bin` prepended to `PATH`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum PreferLocal {
    /// Leave `PATH` untouched.
    #[default]
    Off,
    /// Use the command's working directory.
    Cwd,
    /// Use the given directories (in order).
    Dirs(Vec<PathBuf>),
}

/// Options controlling how commands are run (the fields of zx `$`).
#[derive(Debug, Clone)]
pub struct Options {
    /// Working directory; `None` means the process working directory.
    pub cwd: Option<PathBuf>,
    /// Full environment; `None` inherits the process environment.
    pub env: Option<HashMap<String, String>>,
    /// Shell executable; `None` means no shell is available.
    pub shell: Option<String>,
    /// Text prepended to every command.
    pub prefix: String,
    /// Text appended to every command.
    pub postfix: String,
    /// Log commands and their stdout to stderr.
    pub verbose: bool,
    /// Suppress all logging, including the echo of the command's stderr.
    pub quiet: bool,
    /// Resolve (return `Ok`) even when the command fails.
    pub nothrow: bool,
    /// Kill the command after this long.
    pub timeout: Option<Duration>,
    /// Signal used when the timeout fires.
    pub timeout_signal: String,
    /// Default signal for [`RunningProcess::kill`](super::RunningProcess::kill).
    pub kill_signal: String,
    /// Prepend local `node_modules/.bin` directories to `PATH`.
    pub prefer_local: PreferLocal,
    /// Data written to the command's stdin.
    pub input: Option<Vec<u8>>,
    /// Function used to quote interpolated arguments.
    pub quote: QuoteFn,
}

impl Options {
    /// Built-in defaults: bash (found via `PATH`, falling back to `sh`) with
    /// the `set -euo pipefail;` prefix, everything else off.
    pub fn builtin() -> Self {
        let mut opts = Options {
            cwd: None,
            env: None,
            shell: None,
            prefix: String::new(),
            postfix: String::new(),
            verbose: false,
            quiet: false,
            nothrow: false,
            timeout: None,
            timeout_signal: SIGTERM.to_string(),
            kill_signal: SIGTERM.to_string(),
            prefer_local: PreferLocal::Off,
            input: None,
            quote,
        };
        opts.use_bash();
        opts
    }

    /// Switch to bash: `which bash` (or `sh`), `set -euo pipefail;` prefix,
    /// no postfix, [`quote`].
    pub fn use_bash(&mut self) {
        let bash = find_executable("bash");
        self.prefix = if bash.is_some() {
            BASH_PREFIX.to_string()
        } else {
            String::new()
        };
        self.shell = bash.or_else(|| find_executable("sh"));
        self.postfix = String::new();
        self.quote = quote;
    }

    /// Switch to `pwsh` with PowerShell quoting.
    pub fn use_pwsh(&mut self) {
        self.use_powershell_named("pwsh");
    }

    /// Switch to `powershell.exe` with PowerShell quoting.
    pub fn use_powershell(&mut self) {
        self.use_powershell_named("powershell.exe");
    }

    fn use_powershell_named(&mut self, name: &str) {
        self.shell = Some(find_executable(name).unwrap_or_else(|| name.to_string()));
        self.prefix = String::new();
        self.postfix = POWERSHELL_POSTFIX.to_string();
        self.quote = quote_powershell;
    }

    /// Apply `<prefix>*` environment variables (camel-cased) onto the options.
    ///
    /// Recognised names: `cwd`, `preferLocal`, `verbose`, `quiet`, `timeout`,
    /// `timeoutSignal`, `killSignal`, `prefix`, `postfix`, `shell`. Empty
    /// values and unknown names are ignored.
    pub fn resolve_env<I, K, V>(&mut self, prefix: &str, env: I)
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        for (key, value) in env {
            let (key, value) = (key.as_ref(), value.as_ref());
            let Some(name) = key.strip_prefix(prefix) else {
                continue;
            };
            if value.is_empty() {
                continue;
            }
            let flag = || parse_bool(value).unwrap_or(false);
            match to_camel_case(name).as_str() {
                "cwd" => self.cwd = Some(PathBuf::from(value)),
                "preferLocal" => {
                    self.prefer_local = match parse_bool(value) {
                        Some(true) => PreferLocal::Cwd,
                        Some(false) => PreferLocal::Off,
                        None => PreferLocal::Dirs(vec![PathBuf::from(value)]),
                    }
                }
                "verbose" => self.verbose = flag(),
                "quiet" => self.quiet = flag(),
                "timeout" => self.timeout = parse_duration(value).ok(),
                "timeoutSignal" => self.timeout_signal = value.to_string(),
                "killSignal" => self.kill_signal = value.to_string(),
                "prefix" => self.prefix = value.to_string(),
                "postfix" => self.postfix = value.to_string(),
                "shell" => self.shell = Some(value.to_string()),
                _ => {}
            }
        }
    }

    /// The effective working directory for spawned commands.
    pub fn effective_cwd(&self) -> PathBuf {
        match &self.cwd {
            Some(dir) if dir.is_absolute() => dir.clone(),
            Some(dir) => std::env::current_dir().unwrap_or_default().join(dir),
            None => std::env::current_dir().unwrap_or_default(),
        }
    }
}

impl Default for Options {
    fn default() -> Self {
        Self::builtin()
    }
}

/// Locate an executable on `PATH`.
pub fn find_executable(name: &str) -> Option<String> {
    which::which(name)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

static GLOBAL: Lazy<RwLock<Options>> = Lazy::new(|| {
    let mut opts = Options::builtin();
    opts.resolve_env("ZX_", std::env::vars());
    RwLock::new(opts)
});

tokio::task_local! {
    static SCOPE: RefCell<Options>;
}

fn in_scope() -> bool {
    SCOPE.try_with(|_| ()).is_ok()
}

/// Snapshot of the options active in the current [`within`] scope (or the
/// global defaults, which honour `ZX_*` environment variables).
pub fn current_options() -> Options {
    SCOPE
        .try_with(|scope| scope.borrow().clone())
        .unwrap_or_else(|_| GLOBAL.read().unwrap_or_else(|e| e.into_inner()).clone())
}

/// Mutate the options of the current scope (zx `$.verbose = true`, ...).
///
/// Outside of [`within`] this changes the process-wide defaults.
pub fn configure<R>(update: impl FnOnce(&mut Options) -> R) -> R {
    if in_scope() {
        SCOPE.with(|scope| update(&mut scope.borrow_mut()))
    } else {
        let mut global = GLOBAL.write().unwrap_or_else(|e| e.into_inner());
        update(&mut global)
    }
}

/// Run `fut` with a private copy of the current options, so that changes made
/// inside (via [`configure`] or [`cd`]) do not leak out.
///
/// The scope is task-local: it follows `.await` points but is not inherited
/// by `tokio::spawn`ed tasks.
pub async fn within<F: Future>(fut: F) -> F::Output {
    SCOPE.scope(RefCell::new(current_options()), fut).await
}

/// Synchronous flavour of [`within`].
pub fn within_sync<R>(f: impl FnOnce() -> R) -> R {
    SCOPE.sync_scope(RefCell::new(current_options()), f)
}

/// Switch the current scope to bash.
pub fn use_bash() {
    configure(Options::use_bash);
}

/// Switch the current scope to `pwsh`.
pub fn use_pwsh() {
    configure(Options::use_pwsh);
}

/// Switch the current scope to `powershell.exe`.
pub fn use_powershell() {
    configure(Options::use_powershell);
}

/// Change the working directory of the current scope (zx `cd()`).
///
/// Relative paths resolve against the scope's current directory. The process
/// working directory is left alone so that parallel scopes do not interfere.
/// A [`ProcessOutput`](super::ProcessOutput) can be passed by reference: its
/// trimmed output is used as the path.
pub fn cd<P: AsRef<Path>>(dir: P) -> Result<PathBuf, ZxError> {
    let dir = dir.as_ref();
    let base = current_options().effective_cwd();
    let target = base.join(dir);
    let resolved = std::fs::canonicalize(&target).map_err(|e| {
        ZxError::new(format!(
            "ENOENT: {}, chdir '{}' -> '{}'",
            e,
            base.display(),
            dir.display()
        ))
    })?;
    if !resolved.is_dir() {
        return Err(ZxError::new(format!(
            "ENOTDIR: not a directory, chdir '{}'",
            dir.display()
        )));
    }
    let opts = configure(|opts| {
        opts.cwd = Some(resolved.clone());
        opts.clone()
    });
    let dir = resolved.display().to_string();
    super::log::log(
        &super::log::LogEntry::Cd { dir },
        opts.verbose && !opts.quiet,
    );
    Ok(resolved)
}

/// A command factory carrying [`Options`] (the zx `$`).
///
/// `Shell::new()` snapshots the current scope; the builder methods return a
/// modified copy (zx presets such as `$({verbose: true})`).
#[derive(Debug, Clone, Default)]
pub struct Shell {
    opts: Options,
}

macro_rules! setter {
    ($(#[$doc:meta])* $name:ident: $ty:ty => |$o:ident, $v:ident| $body:expr) => {
        $(#[$doc])*
        pub fn $name(mut self, $v: $ty) -> Self {
            let $o = &mut self.opts;
            $body;
            self
        }
    };
}

impl Shell {
    /// A shell using the options of the current scope.
    pub fn new() -> Self {
        Self {
            opts: current_options(),
        }
    }

    /// A shell with explicit options.
    pub fn with_options(opts: Options) -> Self {
        Self { opts }
    }

    /// The options used by this shell.
    pub fn options(&self) -> &Options {
        &self.opts
    }

    /// Mutable access to the options.
    pub fn options_mut(&mut self) -> &mut Options {
        &mut self.opts
    }

    setter!(/// Set the working directory.
        cwd: impl AsRef<Path> => |o, v| o.cwd = Some(v.as_ref().to_path_buf()));
    setter!(/// Replace the whole environment.
        env: HashMap<String, String> => |o, v| o.env = Some(v));
    setter!(/// Set the shell executable.
        shell: impl Into<String> => |o, v| o.shell = Some(v.into()));
    setter!(/// Set the command prefix.
        prefix: impl Into<String> => |o, v| o.prefix = v.into());
    setter!(/// Set the command postfix.
        postfix: impl Into<String> => |o, v| o.postfix = v.into());
    setter!(/// Enable or disable verbose logging.
        verbose: bool => |o, v| o.verbose = v);
    setter!(/// Enable or disable quiet mode.
        quiet: bool => |o, v| o.quiet = v);
    setter!(/// Do not fail on non-zero exit codes.
        nothrow: bool => |o, v| o.nothrow = v);
    setter!(/// Kill commands after `timeout`.
        timeout: Duration => |o, v| o.timeout = Some(v));
    setter!(/// Signal used on timeout.
        timeout_signal: impl Into<String> => |o, v| o.timeout_signal = v.into());
    setter!(/// Default signal for `kill()`.
        kill_signal: impl Into<String> => |o, v| o.kill_signal = v.into());
    setter!(/// Prepend `<cwd>/node_modules/.bin` to `PATH` when `true`.
        prefer_local: bool => |o, v| o.prefer_local = if v { PreferLocal::Cwd } else { PreferLocal::Off });
    setter!(/// Prepend `<dir>/node_modules/.bin` for each of `dirs` to `PATH`.
        prefer_local_dirs: Vec<PathBuf> => |o, v| o.prefer_local = PreferLocal::Dirs(v));
    setter!(/// Data written to stdin of every command.
        input: impl Into<Vec<u8>> => |o, v| o.input = Some(v.into()));
    setter!(/// Use a custom quoting function.
        quote_with: QuoteFn => |o, v| o.quote = v);

    /// Set a single environment variable (seeding from the process environment
    /// when no explicit environment was configured yet).
    pub fn env_var(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.opts
            .env
            .get_or_insert_with(|| std::env::vars().collect())
            .insert(key.into(), value.into());
        self
    }

    /// Switch to bash.
    pub fn use_bash(mut self) -> Self {
        self.opts.use_bash();
        self
    }

    /// Switch to `pwsh`.
    pub fn use_pwsh(mut self) -> Self {
        self.opts.use_pwsh();
        self
    }

    /// Switch to `powershell.exe`.
    pub fn use_powershell(mut self) -> Self {
        self.opts.use_powershell();
        self
    }

    /// Build a command from template pieces and arguments (the zx tagged
    /// template). Arguments are quoted with the shell's quote function.
    pub fn cmd<S: AsRef<str>>(&self, pieces: &[S], args: &[ZxArg]) -> ProcessPromise {
        let pieces: Vec<&str> = pieces.iter().map(|p| p.as_ref()).collect();
        match build_cmd(self.opts.quote, &pieces, args) {
            Ok(cmd) => ProcessPromise::new(self.opts.clone(), cmd),
            Err(err) => ProcessPromise::failed(self.opts.clone(), err),
        }
    }

    /// Build a command from a raw string (no interpolation, no quoting).
    pub fn command(&self, cmd: impl Into<String>) -> ProcessPromise {
        ProcessPromise::new(self.opts.clone(), cmd.into())
    }
}
