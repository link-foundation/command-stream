//! # command-stream
//!
//! Modern shell command execution library with streaming, async iteration, and event support.
//!
//! This library provides a Rust equivalent to the JavaScript command-stream library,
//! offering powerful shell command execution with streaming capabilities.
//!
//! ## Features
//!
//! - Async command execution with tokio
//! - Streaming output via async iterators
//! - Event-based output handling (on, once, emit)
//! - Virtual commands for common operations (cat, ls, mkdir, etc.)
//! - Shell operator support (&&, ||, ;, |)
//! - Pipeline support with `.pipe()` method and `Pipeline` builder
//! - Global state management for shell settings
//! - `cmd!` macro for ergonomic command creation (similar to JS `$` tagged template literals)
//! - Cross-platform support
//!
//! ## Module Organization
//!
//! The codebase follows a modular architecture similar to the JavaScript implementation:
//!
//! - `ansi` - ANSI escape code handling utilities
//! - `commands` - Virtual command implementations
//! - `events` - Event emitter for stream events
//! - `macros` - The `cmd!` macro for ergonomic command creation
//! - `pipeline` - Pipeline execution support
//! - `quote` - Shell quoting utilities
//! - `shell_parser` - Shell command parsing
//! - `state` - Global state management
//! - `stream` - Async streaming and iteration support
//! - `trace` - Logging and tracing utilities
//! - `utils` - Command results and virtual command helpers
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use command_stream::{run, cmd};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Execute a simple command
//!     let result = run("echo hello world").await?;
//!     println!("{}", result.stdout);
//!
//!     // Using the cmd! macro (similar to JS $ tagged template)
//!     let name = "world";
//!     let result = cmd!("echo hello {}", name).await?;
//!     println!("{}", result.stdout);
//!
//!     // Using pipelines
//!     use command_stream::Pipeline;
//!     let result = Pipeline::new()
//!         .add("echo hello world")
//!         .add("grep world")
//!         .run()
//!         .await?;
//!
//!     Ok(())
//! }
//! ```

// Modular utility modules (following JavaScript modular pattern)
pub mod ansi;
pub mod events;
#[doc(hidden)]
pub mod macros;
pub mod pipeline;
pub mod quote;
pub mod signal;
pub mod state;
pub mod stream;
pub mod terminal;
pub mod trace;

// Core modules
pub mod commands;
pub mod shell_parser;
pub mod utils;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Child;
use tokio::sync::mpsc;

pub use commands::{CommandContext, StreamChunk};
pub use shell_parser::{needs_real_shell, parse_shell_command, ParsedCommand};
pub use utils::{CommandResult, VirtualUtils};

// Re-export modular utilities at crate root for convenient access
pub use ansi::{AnsiConfig, AnsiUtils};
pub use events::{EventData, EventType, StreamEmitter};
pub use pipeline::{Pipeline, PipelineBuilder, PipelineExt};
pub use quote::{
    escape_for_double_quotes, escape_for_single_quotes, has_shell_escapes,
    is_pre_quoted_passthrough_enabled, is_quote_context_enabled, quote, quote_for_context,
    scan_quote_context, QuoteContext,
};
pub use signal::{signal_exit_code, signal_number, DEFAULT_KILL_GRACE_MS, DEFAULT_KILL_SIGNAL};
pub use state::{
    get_shell_settings, global_state, reset_global_state, set_shell_option, unset_shell_option,
    GlobalState, ShellSettings,
};
pub use stream::{AsyncIterator, IntoStream, OutputChunk, OutputStream, StreamingRunner};
pub use trace::trace;

#[derive(Clone, Copy)]
enum ChildOutput {
    Stdout,
    Stderr,
}

/// Read child output as byte chunks so capture does not invent a trailing newline.
///
/// stdout and stderr use separate futures in `ProcessRunner::run`, preventing
/// either pipe from filling while the other is being drained. Mirroring keeps
/// the original bytes too, including output that does not end in a newline.
async fn collect_child_output<R>(
    reader: Option<R>,
    mirror: bool,
    target: ChildOutput,
) -> std::io::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let Some(mut reader) = reader else {
        return Ok(Vec::new());
    };
    let mut collected = Vec::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }

        let chunk = &buffer[..count];
        collected.extend_from_slice(chunk);
        if mirror {
            match target {
                ChildOutput::Stdout => {
                    let mut output = std::io::stdout().lock();
                    let _ = std::io::Write::write_all(&mut output, chunk);
                    let _ = std::io::Write::flush(&mut output);
                }
                ChildOutput::Stderr => {
                    let mut output = std::io::stderr().lock();
                    let _ = std::io::Write::write_all(&mut output, chunk);
                    let _ = std::io::Write::flush(&mut output);
                }
            }
        }
    }

    Ok(collected)
}

fn fallback_cwd() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .unwrap_or_else(std::env::temp_dir)
}

/// Resolve a working directory that is safe to spawn a child process in.
///
/// When no explicit cwd is requested the child normally inherits the parent's
/// working directory. But if that directory has been deleted or become
/// inaccessible (the "getcwd() failed" scenario from issue #44), inheriting it
/// makes the OS-level spawn fail. In that case fall back to a directory that is
/// known to exist so the command still runs.
///
/// Normal behavior is preserved: when an explicit cwd is given, or when the
/// inherited working directory is valid, this returns the requested value
/// (`None` meaning "inherit").
fn resolve_spawn_cwd(cwd: Option<&PathBuf>) -> Option<PathBuf> {
    // An explicit directory is always honored as-is.
    if let Some(c) = cwd {
        return Some(c.clone());
    }

    // No explicit cwd: we would inherit the parent's working directory. Make
    // sure that directory is actually usable before relying on inheritance.
    match std::env::current_dir() {
        Ok(_) => None,
        Err(e) => {
            let fallback = fallback_cwd();
            trace(
                "ProcessRunner",
                &format!(
                    "current_dir() failed ({}); spawning in fallback directory {}",
                    e,
                    fallback.display()
                ),
            );
            Some(fallback)
        }
    }
}

/// Error type for command-stream operations
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Command failed with exit code {code}: {message}")]
    CommandFailed { code: i32, message: String },

    #[error("Command not found: {0}")]
    CommandNotFound(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Cancelled")]
    Cancelled,
}

impl Error {
    /// Build a [`Error::CommandFailed`] for a command that exited with `code`.
    pub fn command_failed(code: i32, message: impl Into<String>) -> Self {
        Error::CommandFailed {
            code,
            message: message.into(),
        }
    }

    /// Exit status carried by the error, when the failure has one.
    ///
    /// Mirrors the `error.code` property of the JavaScript implementation
    /// (issue #38). Failures that never reached a child process, such as parse
    /// errors, report `None`.
    pub fn code(&self) -> Option<i32> {
        match self {
            Error::CommandFailed { code, .. } => Some(*code),
            // `command not found` is 127 in POSIX shells, which is also what
            // the JavaScript implementation reports for a missing executable.
            Error::CommandNotFound(_) => Some(127),
            Error::Io(error) => match error.kind() {
                std::io::ErrorKind::NotFound => Some(127),
                std::io::ErrorKind::PermissionDenied => Some(126),
                _ => None,
            },
            // A cancelled command is terminated with SIGINT (128 + 2).
            Error::Cancelled => Some(130),
            Error::ParseError(_) => None,
        }
    }

    /// Alias for [`code`](Self::code).
    ///
    /// Node.js `child_process` names this property `code`, while execa, zx,
    /// nano-spawn, and Bun Shell name it `exitCode`. command-stream exposes
    /// both spellings in every language (issue #38).
    pub fn exit_code(&self) -> Option<i32> {
        self.code()
    }
}

/// Result type for command-stream operations
pub type Result<T> = std::result::Result<T, Error>;

/// Options for command execution
#[derive(Debug, Clone)]
pub struct RunOptions {
    /// Mirror output to parent stdout/stderr
    pub mirror: bool,
    /// Capture output in result
    pub capture: bool,
    /// Standard input handling
    pub stdin: StdinOption,
    /// Working directory
    pub cwd: Option<PathBuf>,
    /// Environment variables
    pub env: Option<HashMap<String, String>>,
    /// Interactive mode (TTY forwarding)
    pub interactive: bool,
    /// Enable shell operator parsing
    pub shell_operators: bool,
    /// Enable tracing for this command
    pub trace: bool,
    /// Signal used to stop the process when it is killed without an explicit
    /// signal, i.e. [`ProcessRunner::kill`] (default `SIGTERM`).
    ///
    /// Mirrors the JavaScript `killSignal` option. An explicit
    /// [`ProcessRunner::kill_with`] argument always overrides it.
    pub kill_signal: String,
    /// Milliseconds the child is given to handle the kill signal before
    /// `SIGKILL` is sent (default 100).
    ///
    /// Mirrors the JavaScript `killGrace` option. This is the window in which a
    /// child running its own signal handler can shut down on its own terms.
    pub kill_grace_ms: u64,
}

impl Default for RunOptions {
    fn default() -> Self {
        RunOptions {
            mirror: true,
            capture: true,
            stdin: StdinOption::Inherit,
            cwd: None,
            env: None,
            interactive: false,
            shell_operators: true,
            trace: true,
            kill_signal: signal::DEFAULT_KILL_SIGNAL.to_string(),
            kill_grace_ms: signal::DEFAULT_KILL_GRACE_MS,
        }
    }
}

/// Standard input options
#[derive(Debug, Clone)]
pub enum StdinOption {
    /// Inherit from parent process
    Inherit,
    /// Pipe (allow writing to stdin)
    Pipe,
    /// Provide string content
    Content(String),
    /// Null device
    Null,
}

/// A running or completed process
pub struct ProcessRunner {
    command: String,
    options: RunOptions,
    child: Option<Child>,
    /// Process id of the spawned child, recorded at spawn time. `run()` takes
    /// the child in order to await it, so reading the id from it only works
    /// between `start()` and `run()`; this copy is what makes `pid()` answer
    /// after the command has finished too (issue #18).
    pid: Option<u32>,
    result: Option<CommandResult>,
    started: bool,
    finished: bool,
    cancelled: bool,
    /// Whether the child was spawned into a process group of its own, and so
    /// can be signalled as a group. Recorded at spawn time because it cannot be
    /// discovered later: by the time the group is signalled the leader is
    /// usually a zombie, which macOS refuses to answer `getpgid` for.
    #[cfg(unix)]
    own_process_group: bool,
    output_tx: Option<mpsc::Sender<StreamChunk>>,
    // Held, never read: dropping the receiver would close the channel, and
    // streaming virtual commands treat a closed channel as "stop now" (see
    // `commands::yes`, which loops until `output_tx.send` fails). Keeping it
    // alive is what gives those commands their run-until-cancelled behaviour.
    #[allow(dead_code)]
    output_rx: Option<mpsc::Receiver<StreamChunk>>,
}

/// Borrowed access to the operating-system child owned by a [`ProcessRunner`].
///
/// The wrapper keeps process termination on the runner's signal-aware path:
/// [`kill`](Self::kill) and [`kill_with`](Self::kill_with) signal the child and
/// its process group, honor the configured grace period, and then escalate if
/// necessary. Use [`native`](Self::native) or [`native_mut`](Self::native_mut)
/// when direct access to Tokio's child object is required.
pub struct ProcessChild<'a> {
    runner: &'a mut ProcessRunner,
}

impl ProcessChild<'_> {
    /// Process id of the active child.
    pub fn pid(&self) -> Option<u32> {
        self.native().id()
    }

    /// Borrow Tokio's native child process object.
    pub fn native(&self) -> &Child {
        self.runner
            .child
            .as_ref()
            .expect("ProcessChild exists only while its native child is present")
    }

    /// Mutably borrow Tokio's native child process object.
    pub fn native_mut(&mut self) -> &mut Child {
        self.runner
            .child
            .as_mut()
            .expect("ProcessChild exists only while its native child is present")
    }

    /// Stop the child using the runner's configured signal and grace period.
    pub fn kill(&mut self) -> Result<()> {
        self.runner.kill()
    }

    /// Stop the child using an explicit signal and the configured grace period.
    pub fn kill_with(&mut self, signal: &str) -> Result<()> {
        self.runner.kill_with(signal)
    }
}

impl ProcessRunner {
    /// Create a new process runner
    pub fn new(command: impl Into<String>, options: RunOptions) -> Self {
        let (tx, rx) = mpsc::channel(1024);
        ProcessRunner {
            command: command.into(),
            options,
            child: None,
            pid: None,
            result: None,
            started: false,
            finished: false,
            cancelled: false,
            #[cfg(unix)]
            own_process_group: false,
            output_tx: Some(tx),
            output_rx: Some(rx),
        }
    }

    /// Whether the child will read from the caller's terminal.
    ///
    /// Only an *inherited* stdin that is actually a tty counts: a pipe, a null
    /// stdin, or inherited stdin that has been redirected to a file carries no
    /// terminal, and neither does output-only inheritance. This is the one case
    /// where the child must stay in the caller's process group.
    #[cfg(unix)]
    fn shares_the_terminal(&self) -> bool {
        use std::io::IsTerminal;

        self.options.interactive
            || (matches!(self.options.stdin, StdinOption::Inherit)
                && std::io::stdin().is_terminal())
    }

    /// Start the process
    pub async fn start(&mut self) -> Result<()> {
        if self.started {
            return Ok(());
        }
        self.started = true;

        utils::trace_lazy("ProcessRunner", || {
            format!("Starting command: {}", self.command)
        });

        // Check if this is a virtual command. Backslash escapes are removed by a
        // real shell but not by the whitespace splitting used for virtual
        // command args, so such commands always go to the system shell (#49).
        // The same applies to redirection and expansions: whitespace splitting
        // would hand `>`, `out.txt` to the virtual command as two ordinary
        // arguments, so `echo hello > out.txt` printed the redirection instead
        // of writing the file, and `git push ... 2>&1` reported success while
        // nothing was pushed (#46).
        let first_word = if matches!(self.options.stdin, StdinOption::Pipe)
            || has_shell_escapes(&self.command)
            || needs_real_shell(&self.command)
        {
            ""
        } else {
            self.command.split_whitespace().next().unwrap_or("")
        };
        if let Some(result) = self.try_virtual_command(first_word).await {
            self.result = Some(result);
            self.finished = true;
            return Ok(());
        }
        // Parse command for shell operators (for future use with virtual command pipelines)
        let _parsed = if self.options.shell_operators && !needs_real_shell(&self.command) {
            parse_shell_command(&self.command)
        } else {
            None
        };

        // Execute via real shell if needed
        let mut cmd = utils::shell_command(&self.command, self.options.env.as_ref());

        // Configure stdin
        match &self.options.stdin {
            StdinOption::Inherit => {
                cmd.stdin(Stdio::inherit());
            }
            StdinOption::Pipe => {
                cmd.stdin(Stdio::piped());
            }
            StdinOption::Content(_) => {
                cmd.stdin(Stdio::piped());
            }
            StdinOption::Null => {
                cmd.stdin(Stdio::null());
            }
        }

        // Configure stdout/stderr
        if self.options.capture || self.options.mirror {
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::piped());
        } else {
            cmd.stdout(Stdio::inherit());
            cmd.stderr(Stdio::inherit());
        }

        // Set working directory. Fall back to a valid directory when the
        // inherited working directory has been deleted (issue #44).
        if let Some(cwd) = resolve_spawn_cwd(self.options.cwd.as_ref()) {
            cmd.current_dir(cwd);
        }

        // Set environment
        if let Some(ref env_vars) = self.options.env {
            for (key, value) in env_vars {
                cmd.env(key, value);
            }
        }

        // Run the child in its own process group so that killing it can signal
        // the whole group (parent + grandchildren), matching `StreamingRunner`
        // and the JavaScript implementation's `detached` spawn.
        //
        // A child that shares the terminal is deliberately left in the caller's
        // group. The tty delivers CTRL+C to its foreground group only, so
        // moving such a child out would both hide CTRL+C from it and stop it
        // with SIGTTIN the moment it read from the terminal. JavaScript draws
        // the same line, spawning interactive commands without `detached`.
        #[cfg(unix)]
        {
            self.own_process_group = !self.shares_the_terminal();
            if self.own_process_group {
                cmd.process_group(0);
            }
        }

        // Spawn the process
        let child = cmd.spawn()?;
        // Record the id while the child is still held. `run()` takes the child
        // in order to await it, so this copy is what keeps `pid()` readable
        // afterwards.
        self.pid = child.id();
        self.child = Some(child);

        Ok(())
    }

    /// Borrow the active operating-system child.
    ///
    /// Call [`start`](Self::start) first. The result is `None` before startup,
    /// for built-in commands (which run in-process), and after [`run`](Self::run)
    /// consumes and reaps the child. Killing through the returned handle keeps
    /// the runner's process-group and graceful-escalation behavior.
    ///
    /// ```no_run
    /// use command_stream::{ProcessRunner, RunOptions};
    ///
    /// # #[tokio::main]
    /// # async fn main() -> command_stream::Result<()> {
    /// let mut runner = ProcessRunner::new("sleep 30", RunOptions::default());
    /// runner.start().await?;
    /// if let Some(mut child) = runner.child() {
    ///     println!("child pid: {:?}", child.pid());
    ///     child.kill_with("SIGTERM")?;
    /// }
    /// let _ = runner.run().await?;
    /// # Ok(())
    /// # }
    /// ```
    pub fn child(&mut self) -> Option<ProcessChild<'_>> {
        self.child.as_ref()?;
        Some(ProcessChild { runner: self })
    }

    /// Write bytes to the stdin pipe of a running command.
    ///
    /// Configure the runner with [`StdinOption::Pipe`], call [`start`](Self::start),
    /// write as many chunks as needed, and finish with [`close_stdin`](Self::close_stdin).
    pub async fn write_stdin(&mut self, data: impl AsRef<[u8]>) -> Result<()> {
        self.start().await?;
        let stdin = self
            .child
            .as_mut()
            .and_then(|child| child.stdin.as_mut())
            .ok_or_else(|| {
                Error::Io(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "command stdin is not available; use StdinOption::Pipe",
                ))
            })?;
        stdin.write_all(data.as_ref()).await?;
        Ok(())
    }

    /// Close a running command's stdin pipe so it can observe end-of-input.
    pub async fn close_stdin(&mut self) -> Result<()> {
        self.start().await?;
        if let Some(mut stdin) = self.child.as_mut().and_then(|child| child.stdin.take()) {
            stdin.shutdown().await?;
        }
        Ok(())
    }

    /// Run the process to completion
    pub async fn run(&mut self) -> Result<CommandResult> {
        self.start().await?;

        if let Some(result) = &self.result {
            return Ok(result.clone());
        }

        let mut child = self
            .child
            .take()
            .ok_or_else(|| Error::Io(std::io::Error::other("Process not started")))?;

        // Handle stdin content if provided
        if let StdinOption::Content(ref content) = self.options.stdin {
            if let Some(mut stdin) = child.stdin.take() {
                let content = content.clone();
                tokio::spawn(async move {
                    let _ = stdin.write_all(content.as_bytes()).await;
                    let _ = stdin.shutdown().await;
                });
            }
        }

        // Drain both pipes concurrently and preserve their newline framing. The
        // previous line reader appended `\n` to every final line, changing
        // output from commands such as `printf` that omit a newline (issue #37).
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let collected = tokio::try_join!(
            collect_child_output(stdout, self.options.mirror, ChildOutput::Stdout),
            collect_child_output(stderr, self.options.mirror, ChildOutput::Stderr),
        );
        let (stdout, stderr) = match collected {
            Ok(output) => output,
            Err(error) => {
                // `try_join!` drops the other pipe reader after an error. Stop
                // and reap the child so it cannot remain blocked on that pipe.
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err(error.into());
            }
        };

        let status = child.wait().await?;
        let code = status.code().unwrap_or(-1);

        let result = CommandResult {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            code,
        };

        self.result = Some(result.clone());
        self.finished = true;

        Ok(result)
    }

    /// Try to execute as a virtual command
    async fn try_virtual_command(&self, cmd_name: &str) -> Option<CommandResult> {
        if !commands::are_virtual_commands_enabled() {
            return None;
        }

        // An empty command name means the caller already decided this command
        // must go to a real shell (redirection, expansions, escapes). Bail out
        // before tokenizing so we neither waste work nor parse shell syntax we
        // deliberately delegate.
        if cmd_name.is_empty() {
            return None;
        }

        // Parse args from command string, respecting quotes and performing
        // POSIX quote removal so `echo label:'help wanted'` reaches the built-in
        // as the single argument `label:help wanted` (issue #48).
        let words = shell_parser::split_command_words(&self.command);
        let args: Vec<String> = words.into_iter().skip(1).collect();

        let ctx = CommandContext {
            args,
            stdin: match &self.options.stdin {
                StdinOption::Content(s) => Some(s.clone()),
                _ => None,
            },
            cwd: self.options.cwd.clone(),
            env: self.options.env.clone(),
            output_tx: self.output_tx.clone(),
            is_cancelled: None,
        };

        match cmd_name {
            "echo" => Some(commands::echo(ctx).await),
            "pwd" => Some(commands::pwd(ctx).await),
            "cd" => Some(commands::cd::resolve_cd(ctx).await.0),
            "true" => Some(commands::r#true(ctx).await),
            "false" => Some(commands::r#false(ctx).await),
            "sleep" => Some(commands::sleep(ctx).await),
            "cat" => Some(commands::cat(ctx).await),
            "ls" => Some(commands::ls(ctx).await),
            "mkdir" => Some(commands::mkdir(ctx).await),
            "rm" => Some(commands::rm(ctx).await),
            "touch" => Some(commands::touch(ctx).await),
            "cp" => Some(commands::cp(ctx).await),
            "mv" => Some(commands::mv(ctx).await),
            "basename" => Some(commands::basename(ctx).await),
            "dirname" => Some(commands::dirname(ctx).await),
            "env" => Some(commands::env(ctx).await),
            "exit" => Some(commands::exit(ctx).await),
            "which" => Some(commands::which(ctx).await),
            "yes" => Some(commands::yes(ctx).await),
            "seq" => Some(commands::seq(ctx).await),
            "tee" => Some(commands::tee(ctx).await),
            "test" => Some(commands::test(ctx).await),
            _ => None,
        }
    }

    /// Stop the process using the configured kill signal
    /// ([`RunOptions::kill_signal`], default `SIGTERM`).
    ///
    /// Mirrors the JavaScript `kill()` with no argument.
    pub fn kill(&mut self) -> Result<()> {
        let signal = self.options.kill_signal.clone();
        self.kill_with(&signal)
    }

    /// Stop the process using an explicit signal, overriding
    /// [`RunOptions::kill_signal`] for this call.
    ///
    /// Mirrors the JavaScript `kill(signal)`. The signal is delivered to the
    /// child and its process group, so grandchildren behind a `sh -c` wrapper
    /// are stopped too - except for a child sharing the caller's terminal,
    /// which stays in the caller's group so CTRL+C keeps reaching it. The child
    /// then has [`RunOptions::kill_grace_ms`] to run its own handler before
    /// `SIGKILL` follows, so a process that ignores the signal still
    /// terminates.
    ///
    /// ```no_run
    /// use command_stream::{ProcessRunner, RunOptions};
    ///
    /// # #[tokio::main]
    /// # async fn main() -> command_stream::Result<()> {
    /// let mut runner = ProcessRunner::new("sleep 30", RunOptions::default());
    /// runner.start().await?;
    /// runner.kill_with("SIGINT")?; // the CTRL+C signal
    /// # Ok(())
    /// # }
    /// ```
    pub fn kill_with(&mut self, signal: &str) -> Result<()> {
        self.cancelled = true;
        utils::trace_lazy("ProcessRunner", || format!("kill | signal={signal}"));

        let Some(child) = self.child.as_mut() else {
            return Ok(());
        };

        // Windows has no signals to deliver and no handler for the child to
        // run, so there is nothing to grant a grace period to: the forceful
        // stop is the only way to end the process.
        // The `#[cfg(unix)]` block below is stripped on Windows, which leaves
        // this one as the function's tail expression - hence no `return`.
        #[cfg(not(unix))]
        {
            let _ = signal;
            child.start_kill()?;
            Ok(())
        }

        // Without a pid the process never spawned (or was already reaped);
        // fall back to the forceful stop so `kill()` still terminates it.
        #[cfg(unix)]
        {
            let Some(pid) = child.id() else {
                child.start_kill()?;
                return Ok(());
            };

            // `SIGKILL` cannot be handled, so there is nothing to wait for.
            //
            // A zero grace period means the child is given no opportunity to
            // handle the signal either, so the requested signal is not
            // delivered at all. Anything done between it and `SIGKILL` - even a
            // single syscall - is a window the child can be scheduled in, which
            // made "no grace" a race the child occasionally won rather than a
            // guarantee. The reported exit code still comes from the signal
            // that was requested.
            let grace = self.options.kill_grace_ms;
            let delivery = if self.own_process_group {
                signal::Delivery::ProcessAndGroup
            } else {
                signal::Delivery::ProcessOnly
            };
            if grace == 0 || signal == "SIGKILL" {
                signal::send_signal_to_process(pid, "SIGKILL", delivery);
                let _ = child.start_kill();
                return Ok(());
            }

            signal::send_signal_to_process(pid, signal, delivery);

            // Otherwise escalate in the background so the child keeps its grace
            // period without blocking the caller, which may not be inside an
            // await point.
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(grace)).await;
                // Best effort: if the child already exited on the first signal
                // this delivery simply fails, and the pid has not been reused
                // because the `Child` handle above has not reaped it yet. That
                // unreaped leader is also what keeps the group id alive, so the
                // group delivery still reaches a grandchild that outlived it.
                signal::send_signal_to_process(pid, "SIGKILL", delivery);
            });

            Ok(())
        }
    }

    /// Check if the process is finished
    pub fn is_finished(&self) -> bool {
        self.finished
    }

    /// Get the result if available
    pub fn result(&self) -> Option<&CommandResult> {
        self.result.as_ref()
    }

    /// Process id of the command, or `None` when there is no operating system
    /// process to identify.
    ///
    /// It is `None` before the command starts, and stays `None` for built-in
    /// (virtual) commands such as `echo` or `sleep`, which run inside this
    /// process and never spawn a child. Once a real command has been spawned
    /// the value is stable: it remains readable after the command finishes,
    /// unlike the child handle, which [`run`](Self::run) consumes.
    ///
    /// Mirrors the JavaScript `runner.pid` property.
    ///
    /// ```no_run
    /// use command_stream::{ProcessRunner, RunOptions};
    ///
    /// # #[tokio::main]
    /// # async fn main() -> command_stream::Result<()> {
    /// let mut runner = ProcessRunner::new("/bin/sleep 1", RunOptions::default());
    /// runner.start().await?;
    /// println!("running as pid {:?}", runner.pid());
    /// runner.run().await?;
    /// println!("still readable: {:?}", runner.pid());
    /// # Ok(())
    /// # }
    /// ```
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Get the command string
    pub fn command(&self) -> &str {
        &self.command
    }

    /// Get the options
    pub fn options(&self) -> &RunOptions {
        &self.options
    }
}

/// Execute a command and return the result
///
/// This is the main entry point for simple command execution.
/// Named `run` instead of `$` since `$` is not a valid Rust identifier.
pub async fn run(command: impl Into<String>) -> Result<CommandResult> {
    let mut runner = ProcessRunner::new(command, RunOptions::default());
    runner.run().await
}

/// Alias for `run` function - for JavaScript-like API feel
/// Since `$` is not valid in Rust, this provides a similar short name
pub use run as execute;

/// Execute a command with custom options
pub async fn exec(command: impl Into<String>, options: RunOptions) -> Result<CommandResult> {
    let mut runner = ProcessRunner::new(command, options);
    runner.run().await
}

/// Create a new process runner without starting it
pub fn create(command: impl Into<String>, options: RunOptions) -> ProcessRunner {
    ProcessRunner::new(command, options)
}

/// Execute a command synchronously (blocking)
pub fn run_sync(command: impl Into<String>) -> Result<CommandResult> {
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(run(command))
}

// Tests are located in tests/ directory for better organization
