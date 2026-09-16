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
use std::process::Stdio;
use std::time::Duration;
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::signal::{
    send_signal_to_process, signal_exit_code, Delivery, DEFAULT_KILL_GRACE_MS, DEFAULT_KILL_SIGNAL,
};
use crate::trace::trace_lazy;
use crate::{CommandResult, Result};

/// Default grace period (in milliseconds) to keep draining the stdio pipes
/// after the process has exited before aborting any lingering readers. Mirrors
/// the JavaScript `exitPumpGrace` default.
const DEFAULT_EXIT_PUMP_GRACE_MS: u64 = 100;

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
    stdin_content: Option<String>,
    kill_signal: String,
    kill_grace_ms: u64,
    exit_pump_grace_ms: u64,
}

#[derive(Clone)]
enum StreamingCommand {
    Shell(String),
    Argv {
        program: OsString,
        args: Vec<OsString>,
    },
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
            stdin_content: None,
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

    /// Set stdin content
    pub fn stdin(mut self, content: impl Into<String>) -> Self {
        self.stdin_content = Some(content.into());
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

    fn spawn(mut self) -> (OutputStream, JoinHandle<Result<()>>) {
        let (tx, rx) = mpsc::channel(1024);
        // Unbounded so a synchronous Drop can request a kill without awaiting.
        let (kill_tx, kill_rx) = mpsc::unbounded_channel::<String>();
        // The child is spawned inside the task below, so its id is not known
        // when this returns. The task publishes it here as soon as the spawn
        // succeeds; `OutputStream::pid` reads the latest value (issue #18).
        let (pid_tx, pid_rx) = watch::channel(None);

        // Spawn the process handling task
        let command = self.command.clone();
        let cwd = self.cwd.take();
        let env = self.env.take();
        let stdin_content = self.stdin_content.take();
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
            };
            let result =
                run_streaming_process(command, cwd, env, stdin_content, grace, channels).await;
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

        Ok(CommandResult {
            stdout: String::from_utf8_lossy(&stdout).to_string(),
            stderr: String::from_utf8_lossy(&stderr).to_string(),
            code: exit_code,
        })
    }
}

/// Stream of output chunks from a process
pub struct OutputStream {
    rx: mpsc::Receiver<OutputChunk>,
    kill_tx: mpsc::UnboundedSender<String>,
    kill_signal: String,
    killed: bool,
    pid_rx: watch::Receiver<Option<u32>>,
}

impl OutputStream {
    /// Receive the next chunk
    pub async fn next(&mut self) -> Option<OutputChunk> {
        self.rx.recv().await
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

/// The channels `run_streaming_process` communicates over: output chunks out,
/// kill requests in, and the child's id published once the spawn succeeds.
struct StreamChannels {
    /// Carries the output chunks, and finally the `Exit` chunk, to the consumer.
    output_tx: mpsc::Sender<OutputChunk>,
    /// Carries kill requests, by signal name, in from the consumer.
    kill_rx: mpsc::UnboundedReceiver<String>,
    /// Publishes the child's id, which is only known inside the spawning task.
    pid_tx: watch::Sender<Option<u32>>,
}

/// How long the runner waits, in milliseconds, at the two points where it gives
/// something a chance to finish on its own before forcing the issue.
#[derive(Debug, Clone, Copy)]
struct GraceWindows {
    /// Time allowed for the readers to drain buffered output after the child
    /// exits, before the `Exit` chunk is emitted.
    exit_pump_ms: u64,
    /// Time allowed for the child to handle the delivered signal, before the
    /// escalation to `SIGKILL`.
    kill_ms: u64,
}

/// Run a streaming process and send output to the channel
async fn run_streaming_process(
    command: StreamingCommand,
    cwd: Option<PathBuf>,
    env: Option<HashMap<String, String>>,
    stdin_content: Option<String>,
    grace: GraceWindows,
    channels: StreamChannels,
) -> Result<()> {
    let StreamChannels {
        output_tx: tx,
        mut kill_rx,
        pid_tx,
    } = channels;
    trace_lazy("StreamingRunner", || match &command {
        StreamingCommand::Shell(command) => format!("Starting: {command}"),
        StreamingCommand::Argv { program, args } => {
            format!("Starting argv command: {program:?} {args:?}")
        }
    });

    let mut cmd = match command {
        StreamingCommand::Shell(command) => crate::utils::shell_command(&command, env.as_ref()),
        StreamingCommand::Argv { program, args } => {
            let mut cmd = Command::new(program);
            cmd.args(args);
            cmd
        }
    };

    // Configure stdio
    if stdin_content.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Run the child in its own process group so we can signal the whole group
    // (parent + grandchildren), matching the JavaScript implementation.
    #[cfg(unix)]
    cmd.process_group(0);

    // Set working directory
    if let Some(ref cwd) = cwd {
        cmd.current_dir(cwd);
    }

    // Set environment
    if let Some(ref env_vars) = env {
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
    }

    let mut child = cmd.spawn()?;
    // Publish the id before any awaiting, so a consumer asking for it as soon
    // as the first chunk arrives already sees it.
    let _ = pid_tx.send(child.id());

    // Write stdin if needed
    if let Some(content) = stdin_content {
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(content.as_bytes()).await;
            let _ = stdin.shutdown().await;
        }
    }

    // Spawn stdout reader
    let stdout = child.stdout.take();
    let tx_stdout = tx.clone();
    let stdout_handle = stdout.map(|stdout| {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut buf = vec![0u8; 8192];
            loop {
                use tokio::io::AsyncReadExt;
                match reader.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_stdout
                            .send(OutputChunk::Stdout(buf[..n].to_vec()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        })
    });

    // Spawn stderr reader
    let stderr = child.stderr.take();
    let tx_stderr = tx.clone();
    let stderr_handle = stderr.map(|stderr| {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buf = vec![0u8; 8192];
            loop {
                use tokio::io::AsyncReadExt;
                match reader.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_stderr
                            .send(OutputChunk::Stderr(buf[..n].to_vec()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        })
    });

    // Wait for the process to exit OR for a kill request — crucially we do NOT
    // wait for the readers first. If a grandchild keeps the pipe open the
    // readers would never finish, so waiting on them before the exit (as the
    // old implementation did) would hang forever (issue #155).
    let pid = child.id();
    let code;
    tokio::select! {
        status = child.wait() => {
            code = status_to_code(status?);
        }
        maybe_signal = kill_rx.recv() => {
            // A kill was requested (explicit kill()/kill_with() or the stream
            // being dropped). Stop the process group with the requested signal.
            let signal = maybe_signal.unwrap_or_else(|| DEFAULT_KILL_SIGNAL.to_string());
            trace_lazy("StreamingRunner", || format!("Kill requested | signal={}", signal));
            // Give the child its grace period to run its own handler and exit
            // on its own terms, then escalate to a forceful kill so a process
            // that ignores the signal still terminates.
            //
            // A zero grace period means the child is given no opportunity to
            // handle the signal, so the requested signal is not delivered at
            // all. Anything done between it and the forceful kill - a syscall,
            // or awaiting a zero-length timeout, which yields to the runtime -
            // is a window the child can be scheduled in, which made "no grace"
            // a race the child occasionally won rather than a guarantee.
            let survived_grace = if grace.kill_ms == 0 {
                true
            } else {
                if let Some(pid) = pid {
                    // The child is always spawned with `process_group(0)`
                    // above, so it leads the group named by its own pid.
                    send_signal_to_process(pid, &signal, Delivery::ProcessAndGroup);
                }
                tokio::time::timeout(Duration::from_millis(grace.kill_ms), child.wait())
                    .await
                    .is_err()
            };
            if survived_grace {
                if let Some(pid) = pid {
                    send_signal_to_process(pid, "SIGKILL", Delivery::ProcessAndGroup);
                }
                let _ = child.start_kill();
                let _ = child.wait().await;
            }
            // Report the conventional 128 + signal code for the requested
            // signal, matching the JavaScript implementation.
            code = signal_exit_code(&signal);
        }
    }

    // The process has exited. Give the readers a short grace period to flush any
    // buffered output, then abort any that are still blocked on an inherited
    // open pipe so we don't hang.
    let stdout_abort = stdout_handle.as_ref().map(|h| h.abort_handle());
    let stderr_abort = stderr_handle.as_ref().map(|h| h.abort_handle());
    let drain = async {
        if let Some(handle) = stdout_handle {
            let _ = handle.await;
        }
        if let Some(handle) = stderr_handle {
            let _ = handle.await;
        }
    };
    if tokio::time::timeout(Duration::from_millis(grace.exit_pump_ms), drain)
        .await
        .is_err()
    {
        // A reader is still blocked on an inherited open pipe — abort it so the
        // exit chunk is delivered without waiting for the grandchild.
        if let Some(abort) = stdout_abort {
            abort.abort();
        }
        if let Some(abort) = stderr_abort {
            abort.abort();
        }
    }

    // Send exit code (always — even if a reader was aborted).
    let _ = tx.send(OutputChunk::Exit(code)).await;

    trace_lazy("StreamingRunner", || format!("Exited with code: {}", code));

    Ok(())
}

/// Convert an exit status into a numeric exit code, using the conventional
/// `128 + signal` mapping when the process was terminated by a signal.
fn status_to_code(status: std::process::ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(sig) = status.signal() {
            return 128 + sig;
        }
    }
    -1
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
