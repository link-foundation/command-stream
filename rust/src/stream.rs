//! Streaming and async iteration support
//!
//! This module provides async streaming capabilities similar to JavaScript's
//! async iterators and stream handling in `$.stream-utils.mjs`.
//!
//! It mirrors the JavaScript implementation's behavior for issue #155:
//!
//!   1. The stream yields an explicit `OutputChunk::Exit(code)` when the
//!      process exits, so consumers can observe the exit code from inside the
//!      loop.
//!   2. The stream does not hang forever when the process has exited but a
//!      grandchild keeps the stdio pipes open (the readers are drained with a
//!      grace period and then aborted).
//!   3. The process can be stopped from inside the loop via
//!      [`OutputStream::kill`] / [`OutputStream::kill_with`], and abandoning the
//!      stream (e.g. `break`) also stops the process.
//!   4. The stop signal is configurable via
//!      [`StreamingRunner::kill_signal`] (default `SIGTERM`), just like the
//!      JavaScript `killSignal` option.
//!
//! ## Usage
//!
//! ```rust,no_run
//! use command_stream::{StreamingRunner, OutputChunk};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let runner = StreamingRunner::new("yes hello");
//!
//!     // Stream output as it arrives
//!     let mut stream = runner.stream();
//!     let mut count = 0;
//!     while let Some(chunk) = stream.next().await {
//!         match chunk {
//!             OutputChunk::Stdout(data) => {
//!                 print!("{}", String::from_utf8_lossy(&data));
//!                 count += 1;
//!                 if count >= 5 {
//!                     // Stop the process from inside the loop.
//!                     stream.kill();
//!                 }
//!             }
//!             OutputChunk::Stderr(data) => {
//!                 eprint!("{}", String::from_utf8_lossy(&data));
//!             }
//!             OutputChunk::Exit(code) => {
//!                 println!("Process exited with code: {}", code);
//!                 break;
//!             }
//!         }
//!     }
//!
//!     Ok(())
//! }
//! ```

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::signal::{DEFAULT_KILL_GRACE_MS, DEFAULT_KILL_SIGNAL};
use crate::stream_process::{
    run_streaming_process, ChildEnv, GraceWindows, ProcessSetup, StreamChannels, StreamingCommand,
};
use crate::stream_stdin::{StdinRequest, StdinSender};
use crate::trace::trace_lazy;
use crate::{CommandResult, Result};

/// Default grace period (in milliseconds) to keep draining the stdio pipes
/// after the process has exited before aborting any lingering readers. Mirrors
/// the JavaScript `exitPumpGrace` default.
pub(crate) const DEFAULT_EXIT_PUMP_GRACE_MS: u64 = 100;

/// A chunk of output from a streaming process
#[derive(Debug, Clone)]
pub enum OutputChunk {
    /// Stdout data
    Stdout(Vec<u8>),
    /// Stderr data
    Stderr(Vec<u8>),
    /// Process exit code
    Exit(i32),
}

/// A streaming process runner that allows async iteration over output
pub struct StreamingRunner {
    command: StreamingCommand,
    cwd: Option<PathBuf>,
    env: Option<HashMap<String, String>>,
    env_clear: bool,
    env_remove: Vec<String>,
    prefer_local: crate::PreferLocal,
    stdin_content: Option<Vec<u8>>,
    stdin_pipe: bool,
    timeout: Option<Duration>,
    kill_signal: String,
    kill_grace_ms: u64,
    exit_pump_grace_ms: u64,
}

impl StreamingRunner {
    /// Create a streaming runner for a command string interpreted by the
    /// platform shell.
    pub fn new(command: impl Into<String>) -> Self {
        Self::with_command(StreamingCommand::Shell(command.into()))
    }

    /// Create a streaming runner for an executable and exact argument vector.
    ///
    /// Unlike [`StreamingRunner::new`], this constructor bypasses the platform
    /// shell. Argument boundaries are therefore preserved on every platform,
    /// including Windows, without requiring shell-specific quoting.
    pub fn from_argv<P, I, S>(program: P, args: I) -> Self
    where
        P: Into<OsString>,
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        Self::with_command(StreamingCommand::Argv {
            program: program.into(),
            args: args.into_iter().map(Into::into).collect(),
        })
    }

    fn with_command(command: StreamingCommand) -> Self {
        StreamingRunner {
            command,
            cwd: None,
            env: None,
            env_clear: false,
            env_remove: Vec::new(),
            prefer_local: crate::PreferLocal::Off,
            stdin_content: None,
            stdin_pipe: false,
            timeout: None,
            kill_signal: DEFAULT_KILL_SIGNAL.to_string(),
            kill_grace_ms: DEFAULT_KILL_GRACE_MS,
            exit_pump_grace_ms: DEFAULT_EXIT_PUMP_GRACE_MS,
        }
    }

    /// Set the working directory
    pub fn cwd(mut self, path: impl Into<PathBuf>) -> Self {
        self.cwd = Some(path.into());
        self
    }

    /// Set environment variables
    pub fn env(mut self, env: HashMap<String, String>) -> Self {
        self.env = Some(env);
        self
    }

    /// Prefer executables from the command's working directory or explicit directories.
    pub fn prefer_local(mut self, preference: crate::PreferLocal) -> Self {
        self.prefer_local = preference;
        self
    }

    /// Set stdin content
    pub fn stdin(mut self, content: impl Into<String>) -> Self {
        self.stdin_content = Some(content.into().into_bytes());
        self
    }

    /// Set binary stdin without UTF-8 conversion.
    pub fn stdin_bytes(mut self, content: impl Into<Vec<u8>>) -> Self {
        self.stdin_content = Some(content.into());
        self
    }

    /// Clear inherited environment variables before applying `env`.
    pub fn clear_env(mut self, clear: bool) -> Self {
        self.env_clear = clear;
        self
    }

    /// Remove one variable from the child's environment, the equivalent of
    /// `env -u NAME` or [`std::process::Command::env_remove`].
    ///
    /// Removals are applied after [`env`](Self::env) and
    /// [`clear_env`](Self::clear_env), so a removed variable is absent even
    /// when the `env` map also sets it.
    ///
    /// ```no_run
    /// use command_stream::StreamingRunner;
    ///
    /// # async fn example() -> command_stream::Result<()> {
    /// let result = StreamingRunner::from_argv("printenv", ["CLAUDECODE"])
    ///     .env_remove("CLAUDECODE")
    ///     .collect()
    ///     .await?;
    /// assert_eq!(result.code, 1); // printenv reports the variable as missing
    /// # Ok(())
    /// # }
    /// ```
    pub fn env_remove(mut self, name: impl Into<String>) -> Self {
        self.env_remove.push(name.into());
        self
    }

    /// Remove several variables from the child's environment. See
    /// [`env_remove`](Self::env_remove).
    pub fn env_remove_all<I, S>(mut self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.env_remove.extend(names.into_iter().map(Into::into));
        self
    }

    /// Keep the child's stdin open for the lifetime of the stream, so that
    /// [`OutputStream::write_stdin`] can send input in reaction to output.
    ///
    /// Without it stdin is the null device (or, with [`stdin`](Self::stdin),
    /// a fixed buffer that is closed once written). Content set with `stdin`
    /// or `stdin_bytes` is still written first. Finish with
    /// [`OutputStream::close_stdin`] so the child reads end-of-file; dropping
    /// the stream closes stdin as well.
    ///
    /// ```no_run
    /// use command_stream::{OutputChunk, StreamingRunner};
    ///
    /// # async fn example() -> command_stream::Result<()> {
    /// let mut stream = StreamingRunner::from_argv("cat", Vec::<String>::new())
    ///     .stdin_pipe()
    ///     .stream();
    /// stream.write_stdin(b"ping\n").await?;
    /// while let Some(chunk) = stream.next().await {
    ///     if let OutputChunk::Stdout(data) = chunk {
    ///         assert_eq!(data, b"ping\n");
    ///         stream.close_stdin().await?;
    ///     }
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub fn stdin_pipe(mut self) -> Self {
        self.stdin_pipe = true;
        self
    }

    /// Bound the run: once `limit` has passed since the spawn, the child is
    /// stopped with the [`kill_signal`](Self::kill_signal) (then `SIGKILL`
    /// after the grace period), exactly as [`OutputStream::kill`] would.
    ///
    /// Mirrors the JavaScript `timeout` option. The `Exit` chunk carries the
    /// `128 + signal` code (143 for the default `SIGTERM`) and
    /// [`OutputStream::timed_out`] reports `true`.
    pub fn timeout(mut self, limit: Duration) -> Self {
        self.timeout = Some(limit);
        self
    }

    /// Configure the signal used to stop the process when it is killed without
    /// an explicit signal — i.e. [`OutputStream::kill`] or abandoning the
    /// stream. Mirrors the JavaScript `killSignal` option (default `SIGTERM`).
    ///
    /// The reported exit code follows the conventional `128 + signal` mapping
    /// (e.g. `SIGTERM` => 143, `SIGINT` => 130, `SIGKILL` => 137).
    pub fn kill_signal(mut self, signal: impl Into<String>) -> Self {
        self.kill_signal = signal.into();
        self
    }

    /// Configure how long (in milliseconds) the child is given to handle the
    /// kill signal before `SIGKILL` is sent. Mirrors the JavaScript `killGrace`
    /// option (default 100ms).
    ///
    /// This is the window in which a child running its own `SIGTERM` handler
    /// can shut down on its own terms. Set it to `0` to escalate immediately.
    pub fn kill_grace_ms(mut self, ms: u64) -> Self {
        self.kill_grace_ms = ms;
        self
    }

    /// Configure the grace period (in milliseconds) to keep draining the stdio
    /// pipes after the process exits before aborting lingering readers. Mirrors
    /// the JavaScript `exitPumpGrace` option (default 100ms).
    pub fn exit_pump_grace_ms(mut self, ms: u64) -> Self {
        self.exit_pump_grace_ms = ms;
        self
    }

    /// Take the working directory and the environment the child is spawned
    /// with, including the `prefer_local` PATH.
    fn take_child_env(&mut self) -> (Option<PathBuf>, ChildEnv) {
        let cwd = self.cwd.take();
        let mut vars = self.env.take();
        let local_cwd = cwd
            .clone()
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."));
        if let Some((key, path)) =
            crate::local_bin::preferred_path(vars.as_ref(), &local_cwd, &self.prefer_local)
        {
            vars.get_or_insert_with(|| std::env::vars().collect())
                .insert(key, path);
        }
        let env = ChildEnv {
            vars,
            clear: self.env_clear,
            remove: std::mem::take(&mut self.env_remove),
        };
        (cwd, env)
    }

    /// Start the command detached from the caller and return its pid, without
    /// waiting for it (issue #232).
    ///
    /// The child gets null stdio, leads a process group of its own on Unix
    /// (`CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS` on Windows) and is not
    /// killed when anything is dropped, so it keeps running after the caller
    /// returns or exits. [`cwd`](Self::cwd), [`env`](Self::env),
    /// [`clear_env`](Self::clear_env), [`env_remove`](Self::env_remove) and
    /// [`prefer_local`](Self::prefer_local) apply as usual; stdin content,
    /// [`stdin_pipe`](Self::stdin_pipe), [`timeout`](Self::timeout) and the
    /// kill settings do not, since nothing supervises the child. A background
    /// thread reaps it when it exits. No Tokio runtime is needed.
    ///
    /// ```no_run
    /// use command_stream::StreamingRunner;
    ///
    /// let pid = StreamingRunner::from_argv("sleep", ["60"]).cwd("/tmp").detach()?;
    /// println!("started in the background as pid {pid:?}");
    /// # Ok::<(), command_stream::Error>(())
    /// ```
    pub fn detach(mut self) -> Result<Option<u32>> {
        let (cwd, env) = self.take_child_env();
        crate::detach::spawn_detached(&self.command, cwd.as_deref(), &env)
    }

    pub(crate) fn spawn(mut self) -> (OutputStream, JoinHandle<Result<()>>) {
        let (tx, rx) = mpsc::channel(1024);
        // Unbounded so a synchronous Drop can request a kill without awaiting.
        let (kill_tx, kill_rx) = mpsc::unbounded_channel::<String>();
        // The child is spawned inside the task below, so its id is not known
        // when this returns. The task publishes it here as soon as the spawn
        // succeeds; `OutputStream::pid` reads the latest value (issue #18).
        let (pid_tx, pid_rx) = watch::channel(None);
        let (exit_signal_tx, exit_signal_rx) = watch::channel(None);

        // Spawn the process handling task
        let command = self.command.clone();
        let (cwd, env) = self.take_child_env();
        let (timed_out_tx, timed_out_rx) = watch::channel(false);
        let (stdin_tx, stdin_requests) = if self.stdin_pipe {
            let (sender, receiver) = crate::stream_stdin::channel();
            (Some(sender), Some(receiver))
        } else {
            (None, None)
        };
        let setup = ProcessSetup {
            command,
            cwd,
            env,
            stdin_content: self.stdin_content.take(),
            stdin_requests,
            timeout: self.timeout,
            kill_signal: self.kill_signal.clone(),
        };
        let grace = GraceWindows {
            exit_pump_ms: self.exit_pump_grace_ms,
            kill_ms: self.kill_grace_ms,
        };
        let kill_signal = self.kill_signal.clone();

        let task = tokio::spawn(async move {
            let channels = StreamChannels {
                output_tx: tx,
                kill_rx,
                pid_tx,
                exit_signal_tx,
                timed_out_tx,
            };
            let result = run_streaming_process(setup, grace, channels).await;
            if let Err(error) = &result {
                trace_lazy("StreamingRunner", || format!("Error: {error}"));
            }
            result
        });

        (
            OutputStream {
                rx,
                kill_tx,
                kill_signal,
                killed: false,
                pid_rx,
                exit_signal_rx,
                timed_out_rx,
                stdin_tx,
            },
            task,
        )
    }

    /// Start the process and return a stream of output chunks
    pub fn stream(self) -> OutputStream {
        self.spawn().0
    }

    /// Run to completion and collect all output
    pub async fn collect(self) -> Result<CommandResult> {
        let stdin_content = self.stdin_content.clone();
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = 0;

        let (mut stream, task) = self.spawn();
        while let Some(chunk) = stream.rx.recv().await {
            match chunk {
                OutputChunk::Stdout(data) => stdout.extend(data),
                OutputChunk::Stderr(data) => stderr.extend(data),
                OutputChunk::Exit(code) => exit_code = code,
            }
        }

        task.await.map_err(|error| {
            std::io::Error::other(format!("streaming process task failed: {error}"))
        })??;

        let mut result = CommandResult::new(
            String::from_utf8_lossy(&stdout).to_string(),
            String::from_utf8_lossy(&stderr).to_string(),
            exit_code,
        );
        if let Some(content) = stdin_content {
            result.stdin = crate::result_streams::CapturedInput::new(content);
        }
        Ok(result)
    }

    /// Run an exact-argument command to completion from synchronous code.
    ///
    /// Build the command with [`Self::from_argv`] and configure it with the
    /// same `cwd`, `env`, and `stdin` methods used by [`Self::collect`]. Call
    /// this outside a Tokio runtime; async callers should use `collect().await`.
    pub fn collect_blocking(self) -> Result<CommandResult> {
        if tokio::runtime::Handle::try_current().is_ok() {
            return Err(std::io::Error::other(
                "collect_blocking cannot run inside a Tokio runtime; use collect().await",
            )
            .into());
        }
        let runtime = tokio::runtime::Runtime::new()?;
        runtime.block_on(self.collect())
    }
}

/// Stream of output chunks from a process
pub struct OutputStream {
    rx: mpsc::Receiver<OutputChunk>,
    kill_tx: mpsc::UnboundedSender<String>,
    kill_signal: String,
    killed: bool,
    pid_rx: watch::Receiver<Option<u32>>,
    exit_signal_rx: watch::Receiver<Option<String>>,
    timed_out_rx: watch::Receiver<bool>,
    stdin_tx: Option<StdinSender>,
}

impl OutputStream {
    /// Receive the next chunk
    pub async fn next(&mut self) -> Option<OutputChunk> {
        self.rx.recv().await
    }

    /// Signal reported by the native child, available once it exits.
    /// Ordinary exit codes above 128 are not mistaken for signals.
    pub fn exit_signal(&self) -> Option<String> {
        self.exit_signal_rx.borrow().clone()
    }

    /// Whether the [`StreamingRunner::timeout`] elapsed and stopped the child.
    ///
    /// It becomes `true` before the terminating `Exit` chunk is delivered, so
    /// it can be read as soon as that chunk arrives. An explicit kill, or a
    /// child exiting on its own, leaves it `false`.
    pub fn timed_out(&self) -> bool {
        *self.timed_out_rx.borrow()
    }

    /// Write bytes to the child's stdin while it runs, and flush them.
    ///
    /// Requires [`StreamingRunner::stdin_pipe`]. The write is carried out by
    /// the task that owns the pipe, so the output readers keep draining
    /// stdout and stderr meanwhile. Fails with a broken-pipe error when stdin
    /// was never piped, has been closed, or the child has exited.
    pub async fn write_stdin(&self, data: impl AsRef<[u8]>) -> Result<()> {
        let data = data.as_ref().to_vec();
        crate::stream_stdin::request(self.stdin_tx.as_ref(), |ack| StdinRequest::Write(data, ack))
            .await?;
        Ok(())
    }

    /// Close the child's stdin so it reads end-of-file.
    ///
    /// Later [`write_stdin`](Self::write_stdin) calls fail. Closing twice, or
    /// after the child has exited, is a no-op.
    pub async fn close_stdin(&mut self) -> Result<()> {
        let Some(sender) = self.stdin_tx.take() else {
            return Ok(());
        };
        match crate::stream_stdin::request(Some(&sender), StdinRequest::Close).await {
            Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => Ok(()),
            other => Ok(other?),
        }
    }

    /// Process id of the streamed command, as currently known.
    ///
    /// The child is spawned by a background task, so this is `None` for the
    /// short window between [`StreamingRunner::stream`] returning and the spawn
    /// completing, and stays `None` if the spawn failed. From the first
    /// delivered chunk onwards it is set, and it remains readable after the
    /// process has exited. Use [`wait_for_pid`](Self::wait_for_pid) to avoid
    /// the startup window.
    pub fn pid(&self) -> Option<u32> {
        *self.pid_rx.borrow()
    }

    /// Process id of the streamed command, waiting for the spawn to complete.
    ///
    /// Resolves as soon as the child exists, and returns `None` if the process
    /// could never be spawned. This is the streaming counterpart of awaiting a
    /// stream before reading `runner.pid` in JavaScript.
    pub async fn wait_for_pid(&mut self) -> Option<u32> {
        // `wait_for` checks the current value first, so an already-published id
        // returns without waiting. An error means the sending task is gone,
        // which only happens when the spawn failed.
        match self.pid_rx.wait_for(|pid| pid.is_some()).await {
            Ok(pid) => *pid,
            Err(_) => None,
        }
    }

    /// Stop the process using the configured kill signal (default `SIGTERM`).
    ///
    /// This can be called from inside the consumption loop to stop a
    /// long-running or endless process; a terminating `OutputChunk::Exit` is
    /// still delivered afterwards.
    pub fn kill(&mut self) {
        let signal = self.kill_signal.clone();
        self.kill_with(&signal);
    }

    /// Stop the process using an explicit signal, overriding the configured
    /// kill signal for this call.
    pub fn kill_with(&mut self, signal: &str) {
        if self.killed {
            return;
        }
        self.killed = true;
        trace_lazy("OutputStream", || format!("kill | signal={}", signal));
        // Best effort: the task may have already finished, in which case the
        // receiver is gone and the send fails harmlessly.
        let _ = self.kill_tx.send(signal.to_string());
    }

    /// Collect all remaining output into vectors
    pub async fn collect(mut self) -> (Vec<u8>, Vec<u8>, i32) {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = 0;

        while let Some(chunk) = self.rx.recv().await {
            match chunk {
                OutputChunk::Stdout(data) => stdout.extend(data),
                OutputChunk::Stderr(data) => stderr.extend(data),
                OutputChunk::Exit(code) => exit_code = code,
            }
        }

        (stdout, stderr, exit_code)
    }

    /// Collect stdout only, discarding stderr
    pub async fn collect_stdout(mut self) -> Vec<u8> {
        let mut stdout = Vec::new();

        while let Some(chunk) = self.rx.recv().await {
            if let OutputChunk::Stdout(data) = chunk {
                stdout.extend(data);
            }
        }

        stdout
    }
}

impl Drop for OutputStream {
    fn drop(&mut self) {
        // Abandoning the stream (e.g. `break`-ing out of the loop) must stop the
        // process, matching the JavaScript iterator's `finally` cleanup. If the
        // process already finished this is a harmless no-op.
        if !self.killed {
            let _ = self.kill_tx.send(self.kill_signal.clone());
        }
    }
}

/// Async iterator trait for output streams
#[async_trait::async_trait]
pub trait AsyncIterator {
    type Item;

    /// Get the next item from the iterator
    async fn next(&mut self) -> Option<Self::Item>;
}

#[async_trait::async_trait]
impl AsyncIterator for OutputStream {
    type Item = OutputChunk;

    async fn next(&mut self) -> Option<Self::Item> {
        self.rx.recv().await
    }
}

/// Extension trait to convert ProcessRunner into a stream
pub trait IntoStream {
    /// Convert into an output stream
    fn into_stream(self) -> OutputStream;
}

impl IntoStream for crate::ProcessRunner {
    fn into_stream(self) -> OutputStream {
        let streaming = StreamingRunner::new(self.command().to_string());
        streaming.stream()
    }
}
