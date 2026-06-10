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
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::trace::trace_lazy;
use crate::{CommandResult, Result};

/// Default grace period (in milliseconds) to keep draining the stdio pipes
/// after the process has exited before aborting any lingering readers. Mirrors
/// the JavaScript `exitPumpGrace` default.
const DEFAULT_EXIT_PUMP_GRACE_MS: u64 = 100;

/// Default signal used to stop a process when no explicit signal is given.
const DEFAULT_KILL_SIGNAL: &str = "SIGTERM";

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
    command: String,
    cwd: Option<PathBuf>,
    env: Option<HashMap<String, String>>,
    stdin_content: Option<String>,
    kill_signal: String,
    exit_pump_grace_ms: u64,
}

impl StreamingRunner {
    /// Create a new streaming runner
    pub fn new(command: impl Into<String>) -> Self {
        StreamingRunner {
            command: command.into(),
            cwd: None,
            env: None,
            stdin_content: None,
            kill_signal: DEFAULT_KILL_SIGNAL.to_string(),
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

    /// Configure the grace period (in milliseconds) to keep draining the stdio
    /// pipes after the process exits before aborting lingering readers. Mirrors
    /// the JavaScript `exitPumpGrace` option (default 100ms).
    pub fn exit_pump_grace_ms(mut self, ms: u64) -> Self {
        self.exit_pump_grace_ms = ms;
        self
    }

    /// Start the process and return a stream of output chunks
    pub fn stream(mut self) -> OutputStream {
        let (tx, rx) = mpsc::channel(1024);
        // Unbounded so a synchronous Drop can request a kill without awaiting.
        let (kill_tx, kill_rx) = mpsc::unbounded_channel::<String>();

        // Spawn the process handling task
        let command = self.command.clone();
        let cwd = self.cwd.take();
        let env = self.env.take();
        let stdin_content = self.stdin_content.take();
        let grace = self.exit_pump_grace_ms;
        let kill_signal = self.kill_signal.clone();

        tokio::spawn(async move {
            if let Err(e) =
                run_streaming_process(command, cwd, env, stdin_content, grace, tx.clone(), kill_rx)
                    .await
            {
                trace_lazy("StreamingRunner", || format!("Error: {}", e));
            }
        });

        OutputStream {
            rx,
            kill_tx,
            kill_signal,
            killed: false,
        }
    }

    /// Run to completion and collect all output
    pub async fn collect(self) -> Result<CommandResult> {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = 0;

        let mut stream = self.stream();
        while let Some(chunk) = stream.rx.recv().await {
            match chunk {
                OutputChunk::Stdout(data) => stdout.extend(data),
                OutputChunk::Stderr(data) => stderr.extend(data),
                OutputChunk::Exit(code) => exit_code = code,
            }
        }

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
}

impl OutputStream {
    /// Receive the next chunk
    pub async fn next(&mut self) -> Option<OutputChunk> {
        self.rx.recv().await
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

/// Run a streaming process and send output to the channel
async fn run_streaming_process(
    command: String,
    cwd: Option<PathBuf>,
    env: Option<HashMap<String, String>>,
    stdin_content: Option<String>,
    exit_pump_grace_ms: u64,
    tx: mpsc::Sender<OutputChunk>,
    mut kill_rx: mpsc::UnboundedReceiver<String>,
) -> Result<()> {
    trace_lazy("StreamingRunner", || format!("Starting: {}", command));

    let shell = find_available_shell();
    let mut cmd = Command::new(&shell.cmd);
    for arg in &shell.args {
        cmd.arg(arg);
    }
    cmd.arg(&command);

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

    // Spawn the process
    let mut child = cmd.spawn()?;

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
            if let Some(pid) = pid {
                send_signal_to_process(pid, &signal);
            }
            // Give it a brief moment to exit on the requested signal, then
            // escalate to a forceful kill so it always terminates.
            if tokio::time::timeout(Duration::from_millis(exit_pump_grace_ms), child.wait())
                .await
                .is_err()
            {
                let _ = child.start_kill();
                let _ = child.wait().await;
            }
            // Report the conventional 128 + signal code for the requested
            // signal, matching the JavaScript implementation.
            code = 128 + signal_number(&signal);
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
    if tokio::time::timeout(Duration::from_millis(exit_pump_grace_ms), drain)
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

/// Map a signal name to its numeric value for the `128 + signal` exit-code
/// convention. Unknown names fall back to `SIGTERM`.
fn signal_number(signal: &str) -> i32 {
    match signal {
        "SIGHUP" => 1,
        "SIGINT" => 2,
        "SIGQUIT" => 3,
        "SIGKILL" => 9,
        "SIGUSR1" => 10,
        "SIGUSR2" => 12,
        "SIGTERM" => 15,
        _ => 15,
    }
}

/// Send a signal to a process and its process group (best effort).
#[cfg(unix)]
fn send_signal_to_process(pid: u32, signal: &str) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

    let sig = match signal {
        "SIGHUP" => Signal::SIGHUP,
        "SIGINT" => Signal::SIGINT,
        "SIGQUIT" => Signal::SIGQUIT,
        "SIGKILL" => Signal::SIGKILL,
        "SIGUSR1" => Signal::SIGUSR1,
        "SIGUSR2" => Signal::SIGUSR2,
        "SIGTERM" => Signal::SIGTERM,
        _ => Signal::SIGTERM,
    };

    // Signal the process itself.
    let _ = kill(Pid::from_raw(pid as i32), sig);
    // Signal the whole process group (negative pid) to reach grandchildren.
    let _ = kill(Pid::from_raw(-(pid as i32)), sig);
}

/// On non-Unix platforms there is no signal delivery; the forceful
/// `start_kill()` escalation in the caller handles termination.
#[cfg(not(unix))]
fn send_signal_to_process(_pid: u32, _signal: &str) {}

/// Shell configuration
#[derive(Debug, Clone)]
struct ShellConfig {
    cmd: String,
    args: Vec<String>,
}

/// Find an available shell
fn find_available_shell() -> ShellConfig {
    let is_windows = cfg!(windows);

    if is_windows {
        ShellConfig {
            cmd: "cmd.exe".to_string(),
            args: vec!["/c".to_string()],
        }
    } else {
        let shells = [
            ("/bin/sh", "-c"),
            ("/usr/bin/sh", "-c"),
            ("/bin/bash", "-c"),
        ];

        for (cmd, arg) in shells {
            if std::path::Path::new(cmd).exists() {
                return ShellConfig {
                    cmd: cmd.to_string(),
                    args: vec![arg.to_string()],
                };
            }
        }

        ShellConfig {
            cmd: "/bin/sh".to_string(),
            args: vec!["-c".to_string()],
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
