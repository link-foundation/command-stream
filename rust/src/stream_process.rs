//! The task that owns a [`crate::StreamingRunner`] child process.
//!
//! [`run_streaming_process`] spawns the child, pumps its stdio into the
//! stream's channel, and stops it on request, on drop, or when the configured
//! [`crate::StreamingRunner::timeout`] elapses (issue #227).

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::signal::{send_signal_to_process, signal_exit_code, Delivery, DEFAULT_KILL_SIGNAL};
use crate::stream::OutputChunk;
use crate::stream_stdin::{self, StdinReceiver};
use crate::trace::trace_lazy;
use crate::Result;

/// What a streaming runner executes.
#[derive(Clone)]
pub(crate) enum StreamingCommand {
    /// A command string interpreted by the platform shell.
    Shell(String),
    /// An executable and its exact argument vector.
    Argv {
        program: OsString,
        args: Vec<OsString>,
    },
}

impl StreamingCommand {
    /// Build the native command, without any stdio or lifetime configuration.
    pub(crate) fn command(&self, env: Option<&HashMap<String, String>>) -> Command {
        match self {
            StreamingCommand::Shell(command) => crate::utils::shell_command(command, env),
            StreamingCommand::Argv { program, args } => {
                let mut cmd = Command::new(program);
                cmd.args(args);
                cmd
            }
        }
    }
}

/// The environment a child is spawned with.
#[derive(Debug, Clone, Default)]
pub(crate) struct ChildEnv {
    /// Variables to set, applied after `clear`.
    pub(crate) vars: Option<HashMap<String, String>>,
    /// Start from an empty environment instead of the inherited one.
    pub(crate) clear: bool,
    /// Variables to remove, applied last so a removal always wins (issue #229).
    pub(crate) remove: Vec<String>,
}

impl ChildEnv {
    /// Apply the environment to a command about to be spawned.
    pub(crate) fn apply(&self, cmd: &mut std::process::Command) {
        if self.clear {
            cmd.env_clear();
        }
        if let Some(vars) = &self.vars {
            cmd.envs(vars);
        }
        for name in &self.remove {
            cmd.env_remove(name);
        }
    }
}

/// Everything needed to spawn and bound one streaming child.
pub(crate) struct ProcessSetup {
    pub(crate) command: StreamingCommand,
    pub(crate) cwd: Option<PathBuf>,
    pub(crate) env: ChildEnv,
    /// One-shot stdin content, written before any live stdin request.
    pub(crate) stdin_content: Option<Vec<u8>>,
    /// Live stdin requests, present when the runner was built with
    /// [`crate::StreamingRunner::stdin_pipe`] (issue #230).
    pub(crate) stdin_requests: Option<StdinReceiver>,
    /// Stop the child with `kill_signal` once this much time has passed.
    pub(crate) timeout: Option<Duration>,
    /// Signal used when the timeout elapses.
    pub(crate) kill_signal: String,
}

/// The channels `run_streaming_process` communicates over: output chunks out,
/// kill requests in, and the child's id and fate published as they are known.
pub(crate) struct StreamChannels {
    /// Carries the output chunks, and finally the `Exit` chunk, to the consumer.
    pub(crate) output_tx: mpsc::Sender<OutputChunk>,
    /// Carries kill requests, by signal name, in from the consumer.
    pub(crate) kill_rx: mpsc::UnboundedReceiver<String>,
    /// Publishes the child's id, which is only known inside the spawning task.
    pub(crate) pid_tx: watch::Sender<Option<u32>>,
    pub(crate) exit_signal_tx: watch::Sender<Option<String>>,
    /// Set to `true` when the timeout, not the child or a kill, ended the run.
    pub(crate) timed_out_tx: watch::Sender<bool>,
}

/// How long the runner waits, in milliseconds, at the two points where it gives
/// something a chance to finish on its own before forcing the issue.
#[derive(Debug, Clone, Copy)]
pub(crate) struct GraceWindows {
    /// Time allowed for the readers to drain buffered output after the child
    /// exits, before the `Exit` chunk is emitted.
    pub(crate) exit_pump_ms: u64,
    /// Time allowed for the child to handle the delivered signal, before the
    /// escalation to `SIGKILL`.
    pub(crate) kill_ms: u64,
}

/// Run a streaming process and send output to the channel
pub(crate) async fn run_streaming_process(
    setup: ProcessSetup,
    grace: GraceWindows,
    channels: StreamChannels,
) -> Result<()> {
    let ProcessSetup {
        command,
        cwd,
        env,
        stdin_content,
        stdin_requests,
        timeout,
        kill_signal,
    } = setup;
    let StreamChannels {
        output_tx: tx,
        mut kill_rx,
        pid_tx,
        exit_signal_tx,
        timed_out_tx,
    } = channels;
    trace_lazy("StreamingRunner", || match &command {
        StreamingCommand::Shell(command) => format!("Starting: {command}"),
        StreamingCommand::Argv { program, args } => {
            format!("Starting argv command: {program:?} {args:?}")
        }
    });

    let mut cmd = command.command(env.vars.as_ref());
    cmd.kill_on_drop(true);

    // Configure stdio
    if stdin_content.is_some() || stdin_requests.is_some() {
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

    if let Some(ref cwd) = cwd {
        cmd.current_dir(cwd);
    }
    env.apply(cmd.as_std_mut());

    let mut child = cmd.spawn()?;
    // Publish the id before any awaiting, so a consumer asking for it as soon
    // as the first chunk arrives already sees it.
    let _ = pid_tx.send(child.id());

    // Write stdin concurrently with output readers and process cancellation.
    // Filling stdin before reading stdout deadlocks a full-duplex child. A
    // one-shot `stdin` gets a request channel with no sender, so the task
    // writes the content and then shuts stdin down straight away.
    let stdin_handle = child.stdin.take().map(|stdin| {
        let requests = stdin_requests.unwrap_or_else(|| stream_stdin::channel().1);
        stream_stdin::serve(stdin, stdin_content, requests)
    });

    let stdout_handle = child
        .stdout
        .take()
        .map(|stdout| spawn_reader(stdout, tx.clone(), OutputChunk::Stdout));
    let stderr_handle = child
        .stderr
        .take()
        .map(|stderr| spawn_reader(stderr, tx.clone(), OutputChunk::Stderr));

    // A deadline that never fires when no timeout is configured.
    let deadline = async {
        match timeout {
            Some(limit) => tokio::time::sleep(limit).await,
            None => std::future::pending().await,
        }
    };
    tokio::pin!(deadline);

    // Wait for the process to exit, for a kill request or for the deadline -
    // crucially we do NOT wait for the readers first. If a grandchild keeps the
    // pipe open the readers would never finish, so waiting on them before the
    // exit (as the old implementation did) would hang forever (issue #155).
    let code;
    tokio::select! {
        status = child.wait() => {
            let status = status?;
            #[cfg(unix)]
            {
                use std::os::unix::process::ExitStatusExt;
                let signal = status.signal().and_then(|number| {
                    nix::sys::signal::Signal::try_from(number).ok().map(|signal| signal.to_string())
                });
                let _ = exit_signal_tx.send(signal);
            }
            code = status_to_code(status);
        }
        maybe_signal = kill_rx.recv() => {
            // A kill was requested (explicit kill()/kill_with() or the stream
            // being dropped). Stop the process group with the requested signal.
            let signal = maybe_signal.unwrap_or_else(|| DEFAULT_KILL_SIGNAL.to_string());
            trace_lazy("StreamingRunner", || format!("Kill requested | signal={}", signal));
            code = stop_child(&mut child, &signal, grace.kill_ms, &exit_signal_tx).await;
        }
        () = &mut deadline => {
            trace_lazy("StreamingRunner", || {
                format!("Timeout elapsed | timeout={timeout:?} signal={kill_signal}")
            });
            let _ = timed_out_tx.send(true);
            code = stop_child(&mut child, &kill_signal, grace.kill_ms, &exit_signal_tx).await;
        }
    }

    if let Some(handle) = stdin_handle {
        handle.abort();
        let _ = handle.await;
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

/// Forward everything one pipe produces to the stream as `wrap(bytes)` chunks.
fn spawn_reader<R>(
    pipe: R,
    tx: mpsc::Sender<OutputChunk>,
    wrap: fn(Vec<u8>) -> OutputChunk,
) -> JoinHandle<()>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(pipe);
        let mut buf = vec![0u8; 8192];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(wrap(buf[..n].to_vec())).await.is_err() {
                        break;
                    }
                }
            }
        }
    })
}

/// Stop the child with `signal`, escalating to `SIGKILL` after `grace_ms`, and
/// return the conventional `128 + signal` exit code for the requested signal.
async fn stop_child(
    child: &mut Child,
    signal: &str,
    grace_ms: u64,
    exit_signal_tx: &watch::Sender<Option<String>>,
) -> i32 {
    let pid = child.id();
    // Give the child its grace period to run its own handler and exit on its
    // own terms, then escalate to a forceful kill so a process that ignores
    // the signal still terminates.
    //
    // A zero grace period means the child is given no opportunity to handle
    // the signal, so the requested signal is not delivered at all. Anything
    // done between it and the forceful kill - a syscall, or awaiting a
    // zero-length timeout, which yields to the runtime - is a window the child
    // can be scheduled in, which made "no grace" a race the child occasionally
    // won rather than a guarantee.
    if cfg!(unix) && grace_ms > 0 && signal != "SIGKILL" {
        if let Some(pid) = pid {
            // The child is always spawned with `process_group(0)`, so it leads
            // the group named by its own pid.
            send_signal_to_process(pid, signal, Delivery::ProcessAndGroup);
        }
        // Keep the leader unreaped until escalation: its descendants may
        // ignore the first signal even when the leader exits. Reaping it here
        // previously suppressed their SIGKILL.
        tokio::time::sleep(Duration::from_millis(grace_ms)).await;
    }
    if let Some(pid) = pid {
        // Windows uses taskkill here before terminating the parent.
        send_signal_to_process(pid, "SIGKILL", Delivery::ProcessAndGroup);
    }
    let _ = child.start_kill();
    let _ = child.wait().await;
    // Report the conventional 128 + signal code for the requested signal,
    // matching the JavaScript implementation.
    let _ = exit_signal_tx.send(Some(signal.to_string()));
    signal_exit_code(signal)
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
