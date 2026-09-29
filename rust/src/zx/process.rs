//! [`ProcessPromise`] (a prepared zx command) and [`RunningProcess`] (a
//! spawned one), plus the runner that drives the child processes.
//!
//! Like zx, a failed command is reported by handing back its full
//! [`ProcessOutput`] as the error value; keeping it unboxed lets callers match
//! on `Err(out)` and read `out.exit_code` directly.
#![allow(clippy::result_large_err)]

use std::future::{Future, IntoFuture};
use std::path::Path;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, watch};

use super::error::{ZxError, DOCS_URL};
use super::kill::{kill_tree, signal_name};
use super::output::{ErrorInfo, ProcessOutput};
use super::shell::Options;

/// Which stream of a source command feeds a pipe.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum PipeFrom {
    /// Standard output (the default).
    #[default]
    Stdout,
    /// Standard error.
    Stderr,
    /// Both, interleaved.
    Stdall,
}

type BoxedRun = Pin<Box<dyn Future<Output = ProcessOutput> + Send>>;

/// Result of awaiting a command: `Ok` on success (or with `nothrow`), `Err`
/// with the same [`ProcessOutput`] otherwise.
pub type ZxResult = Result<ProcessOutput, ProcessOutput>;

/// A prepared command (zx `ProcessPromise`). Nothing runs until it is
/// awaited, [`run`](Self::run), [`run_sync`](Self::run_sync) or
/// [`spawn`](Self::spawn) is called.
#[derive(Debug, Clone)]
pub struct ProcessPromise {
    opts: Options,
    cmd: String,
    build_error: Option<ZxError>,
    source: Option<Box<(ProcessPromise, PipeFrom)>>,
}

impl ProcessPromise {
    /// A command with the given options.
    pub fn new(opts: Options, cmd: impl Into<String>) -> Self {
        Self {
            opts,
            cmd: cmd.into(),
            build_error: None,
            source: None,
        }
    }

    /// A command that fails immediately with `err` when run.
    pub fn failed(opts: Options, err: ZxError) -> Self {
        Self {
            opts,
            cmd: String::new(),
            build_error: Some(err),
            source: None,
        }
    }

    /// The command without prefix and postfix.
    pub fn cmd(&self) -> &str {
        &self.cmd
    }

    /// The command as passed to the shell: `prefix + cmd + postfix`.
    pub fn full_cmd(&self) -> String {
        format!("{}{}{}", self.opts.prefix, self.cmd, self.opts.postfix)
    }

    /// The options of this command.
    pub fn options(&self) -> &Options {
        &self.opts
    }

    /// Resolve with the output even when the command fails.
    pub fn nothrow(mut self) -> Self {
        self.opts.nothrow = true;
        self
    }

    /// Suppress logging for this command.
    pub fn quiet(mut self) -> Self {
        self.opts.quiet = true;
        self
    }

    /// Log the command and its output to stderr.
    pub fn verbose(mut self) -> Self {
        self.opts.verbose = true;
        self
    }

    /// Kill the command after `timeout` (with the timeout signal).
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.opts.timeout = Some(timeout);
        self
    }

    /// Kill the command after `timeout` with `signal`.
    pub fn timeout_with(mut self, timeout: Duration, signal: impl Into<String>) -> Self {
        self.opts.timeout = Some(timeout);
        self.opts.timeout_signal = signal.into();
        self
    }

    /// Default signal for [`RunningProcess::kill`].
    pub fn kill_signal(mut self, signal: impl Into<String>) -> Self {
        self.opts.kill_signal = signal.into();
        self
    }

    /// Write `data` to the command's stdin.
    pub fn input(mut self, data: impl Into<Vec<u8>>) -> Self {
        self.opts.input = Some(data.into());
        self
    }

    /// Feed this command's stdout into `dest`'s stdin; returns `dest`.
    ///
    /// When this command fails (and is not `nothrow`) the destination is
    /// stopped and inherits its exit code, so the pipeline fails as a whole.
    pub fn pipe(self, dest: ProcessPromise) -> ProcessPromise {
        self.pipe_from(PipeFrom::Stdout, dest)
    }

    /// Feed this command's stderr into `dest`.
    pub fn pipe_stderr(self, dest: ProcessPromise) -> ProcessPromise {
        self.pipe_from(PipeFrom::Stderr, dest)
    }

    /// Feed this command's interleaved stdout and stderr into `dest`.
    pub fn pipe_stdall(self, dest: ProcessPromise) -> ProcessPromise {
        self.pipe_from(PipeFrom::Stdall, dest)
    }

    /// Feed the selected stream into `dest`. If `dest` already has a source,
    /// this command is attached at the head of its pipeline.
    pub fn pipe_from(self, from: PipeFrom, mut dest: ProcessPromise) -> ProcessPromise {
        match dest.source.take() {
            None => dest.source = Some(Box::new((self, from))),
            Some(link) => {
                let (head, head_from) = *link;
                dest.source = Some(Box::new((self.pipe_from(from, head), head_from)));
            }
        }
        dest
    }

    /// Run the command writing its stdout into the file at `path`.
    pub async fn pipe_to_file(self, path: impl AsRef<Path>) -> ZxResult {
        self.pipe_to_file_from(PipeFrom::Stdout, path).await
    }

    /// Run the command writing the selected stream into the file at `path`.
    pub async fn pipe_to_file_from(self, from: PipeFrom, path: impl AsRef<Path>) -> ZxResult {
        let nothrow = self.opts.nothrow;
        let label = self.cmd.clone();
        let mut file = match tokio::fs::File::create(path.as_ref()).await {
            Ok(file) => file,
            Err(err) => return Err(ProcessOutput::from_error(ErrorInfo::from_io(&err), label)),
        };
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let writer = async move {
            let mut result = Ok(());
            while let Some(chunk) = rx.recv().await {
                if result.is_ok() {
                    result = file.write_all(&chunk).await;
                }
            }
            result.and(file.flush().await)
        };
        let tap = Tap { from, tx };
        let (out, written) =
            tokio::join!(execute_chain(self, None, Some(tap), Control::new()), writer);
        if let Err(err) = written {
            return Err(ProcessOutput::from_error(ErrorInfo::from_io(&err), label));
        }
        settle(out, nothrow)
    }

    /// Run the command to completion.
    pub async fn run(self) -> ZxResult {
        let nothrow = self.opts.nothrow;
        settle(
            execute_chain(self, None, None, Control::new()).await,
            nothrow,
        )
    }

    /// Run the command synchronously (on a helper thread with its own
    /// runtime, so it is safe to call from inside or outside of tokio).
    pub fn run_sync(self) -> ZxResult {
        let worker =
            std::thread::spawn(move || {
                match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt.block_on(self.run()),
                    Err(err) => Err(ProcessOutput::from_error(ErrorInfo::from_io(&err), "")),
                }
            });
        worker.join().unwrap_or_else(|_| {
            Err(ProcessOutput::from_error(
                ErrorInfo::new("zx runner thread panicked"),
                "",
            ))
        })
    }

    /// Start the command in the background (requires a tokio runtime).
    pub fn spawn(self) -> RunningProcess {
        let ctl = Control::new();
        let nothrow = self.opts.nothrow;
        let kill_signal = self.opts.kill_signal.clone();
        let handle = tokio::spawn(execute_chain(self, None, None, ctl.clone()));
        RunningProcess {
            handle,
            ctl,
            nothrow,
            kill_signal,
        }
    }
}

impl IntoFuture for ProcessPromise {
    type Output = ZxResult;
    type IntoFuture = Pin<Box<dyn Future<Output = ZxResult> + Send>>;

    fn into_future(self) -> Self::IntoFuture {
        Box::pin(self.run())
    }
}

fn settle(out: ProcessOutput, nothrow: bool) -> ZxResult {
    if out.ok() || nothrow {
        Ok(out)
    } else {
        Err(out)
    }
}

/// A command started with [`ProcessPromise::spawn`].
#[derive(Debug)]
pub struct RunningProcess {
    handle: tokio::task::JoinHandle<ProcessOutput>,
    ctl: Control,
    nothrow: bool,
    kill_signal: String,
}

impl RunningProcess {
    /// Pid of the (last) shell process, once it has been spawned.
    pub async fn pid(&self) -> Option<u32> {
        let mut rx = self.ctl.pid.subscribe();
        loop {
            if let Some(pid) = *rx.borrow_and_update() {
                return Some(pid);
            }
            if self.is_finished() || rx.changed().await.is_err() {
                return *rx.borrow();
            }
        }
    }

    /// `true` once the command has exited.
    pub fn is_finished(&self) -> bool {
        self.ctl.finished.load(Ordering::SeqCst)
    }

    /// Send `signal` (default: the `kill_signal` option) to the process tree.
    pub fn kill(&self, signal: Option<&str>) -> Result<(), ZxError> {
        if self.is_finished() {
            return Err(ZxError::new("Too late to kill the process."));
        }
        let signal = signal.unwrap_or(&self.kill_signal).to_string();
        #[cfg(unix)]
        super::kill::parse_signal(&signal)?;
        self.ctl.kill.send_replace(Some(signal));
        Ok(())
    }

    /// Wait for the command to finish.
    pub async fn wait(self) -> ZxResult {
        match self.handle.await {
            Ok(out) => settle(out, self.nothrow),
            Err(err) => Err(ProcessOutput::from_error(
                ErrorInfo::new(err.to_string()),
                "",
            )),
        }
    }
}

#[derive(Debug, Clone)]
struct Control {
    kill: Arc<watch::Sender<Option<String>>>,
    pid: Arc<watch::Sender<Option<u32>>>,
    finished: Arc<AtomicBool>,
}

impl Control {
    fn new() -> Self {
        Self {
            kill: Arc::new(watch::Sender::new(None)),
            pid: Arc::new(watch::Sender::new(None)),
            finished: Arc::new(AtomicBool::new(false)),
        }
    }

    fn finish(&self) {
        self.finished.store(true, Ordering::SeqCst);
        self.pid.send_modify(|_| {});
    }
}

struct Tap {
    from: PipeFrom,
    tx: mpsc::UnboundedSender<Vec<u8>>,
}

/// Polls (5ms each) a failed pipe source waits for the destination to finish
/// on its own before killing it.
const PIPE_BREAK_GRACE_STEPS: usize = 20;

fn execute_chain(
    mut p: ProcessPromise,
    feed: Option<mpsc::UnboundedReceiver<Vec<u8>>>,
    tap: Option<Tap>,
    ctl: Control,
) -> BoxedRun {
    Box::pin(async move {
        let Some(link) = p.source.take() else {
            return execute_one(p, feed, tap, ctl).await;
        };
        let (src, from) = *link;
        let (tx, rx) = mpsc::unbounded_channel();
        let src_nothrow = src.opts.nothrow;
        let dest_ctl = ctl.clone();
        let dest_signal = p.opts.kill_signal.clone();
        let src_run = async move {
            let out = execute_chain(src, feed, Some(Tap { from, tx }), Control::new()).await;
            let broken = !out.ok() && !src_nothrow;
            if broken {
                // Give the destination a moment to drain what the source
                // already produced (its stdin is closed now) before breaking.
                for _ in 0..PIPE_BREAK_GRACE_STEPS {
                    if dest_ctl.finished.load(Ordering::SeqCst) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            }
            if broken && !dest_ctl.finished.load(Ordering::SeqCst) {
                let signal = out.signal.clone().unwrap_or(dest_signal);
                dest_ctl.kill.send_replace(Some(signal));
            }
            (out, broken)
        };
        let ((src_out, broken), mut out) =
            tokio::join!(src_run, execute_one(p, Some(rx), tap, ctl));
        if broken {
            out.exit_code = src_out.exit_code;
            if src_out.signal.is_some() {
                out.signal = src_out.signal;
            }
            if out.error.is_none() {
                out.error = src_out.error;
            }
        }
        out
    })
}

async fn execute_one(
    p: ProcessPromise,
    feed: Option<mpsc::UnboundedReceiver<Vec<u8>>>,
    tap: Option<Tap>,
    ctl: Control,
) -> ProcessOutput {
    let out = spawn_and_wait(p, feed, tap, &ctl).await;
    ctl.finish();
    out
}

#[derive(Default)]
struct Store {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    stdall: Vec<u8>,
}

fn log_bytes(data: &[u8]) {
    eprint!("{}", String::from_utf8_lossy(data));
}

fn configure_command(
    opts: &Options,
    shell: &str,
    full_cmd: &str,
    cwd: &Path,
) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(shell);
    command
        .arg("-c")
        .arg(full_cmd)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(env) = &opts.env {
        command.env_clear().envs(env);
    }
    crate::local_bin::apply_prefer_local(&mut command, opts.env.as_ref(), cwd, &opts.prefer_local);
    #[cfg(unix)]
    command.process_group(0);
    command
}

async fn spawn_and_wait(
    p: ProcessPromise,
    feed: Option<mpsc::UnboundedReceiver<Vec<u8>>>,
    tap: Option<Tap>,
    ctl: &Control,
) -> ProcessOutput {
    let ProcessPromise {
        opts,
        cmd,
        build_error,
        ..
    } = p;
    if let Some(err) = build_error {
        return ProcessOutput::from_error(ErrorInfo::new(err.message()), cmd);
    }
    let Some(shell) = opts.shell.clone() else {
        let msg = format!("No shell is available: {DOCS_URL}/shell");
        return ProcessOutput::from_error(ErrorInfo::new(msg), cmd);
    };
    let cwd = opts.effective_cwd();
    if !cwd.is_dir() {
        let msg = format!("The working directory '{}' does not exist.", cwd.display());
        return ProcessOutput::from_error(ErrorInfo::new(msg), cmd);
    }
    let full_cmd = format!("{}{}{}", opts.prefix, cmd, opts.postfix);
    let mut command = configure_command(&opts, &shell, &full_cmd, &cwd);
    if opts.verbose && !opts.quiet {
        super::log::log(&super::log::LogEntry::Cmd { cmd: cmd.clone() }, true);
    }
    let started = Instant::now();
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            return ProcessOutput::from_error(ErrorInfo::from_io(&err), cmd)
                .with_duration(started.elapsed())
        }
    };
    let pid = child.id();
    ctl.pid.send_replace(pid);

    let store = Mutex::new(Store::default());
    let stdin = child.stdin.take();
    let input = opts.input.clone();
    let stdin_fut = async move {
        let Some(mut writer) = stdin else { return };
        if let Some(data) = input {
            let _ = writer.write_all(&data).await;
        } else if let Some(mut feed) = feed {
            while let Some(chunk) = feed.recv().await {
                if writer.write_all(&chunk).await.is_err() {
                    break;
                }
            }
        }
        let _ = writer.shutdown().await;
    };
    let log_stdout = opts.verbose && !opts.quiet && tap.is_none();
    let log_stderr = !opts.quiet;
    let read_out = read_stream(child.stdout.take(), false, &store, tap.as_ref(), log_stdout);
    let read_err = read_stream(child.stderr.take(), true, &store, tap.as_ref(), log_stderr);
    let status = {
        let wait = wait_child(&mut child, pid, &opts, ctl);
        let main = async { tokio::join!(wait, read_out, read_err).0 };
        tokio::pin!(main);
        tokio::pin!(stdin_fut);
        let mut stdin_done = false;
        loop {
            tokio::select! {
                status = &mut main => break status,
                _ = &mut stdin_fut, if !stdin_done => stdin_done = true,
            }
        }
    };
    drop(tap);
    let duration = started.elapsed();
    let store = store.into_inner().unwrap_or_else(|e| e.into_inner());
    let mut out = ProcessOutput::new(
        None,
        None,
        String::from_utf8_lossy(&store.stdout),
        String::from_utf8_lossy(&store.stderr),
        String::from_utf8_lossy(&store.stdall),
    )
    .with_from(cmd.clone())
    .with_duration(duration);
    match status {
        Ok(status) => {
            out.exit_code = status.code();
            #[cfg(unix)]
            {
                use std::os::unix::process::ExitStatusExt;
                out.signal = status.signal().and_then(signal_name);
            }
        }
        Err(err) => out.error = Some(ErrorInfo::from_io(&err)),
    }
    #[cfg(not(unix))]
    let _ = signal_name;
    out
}

async fn wait_child(
    child: &mut tokio::process::Child,
    pid: Option<u32>,
    opts: &Options,
    ctl: &Control,
) -> std::io::Result<std::process::ExitStatus> {
    let deadline = opts.timeout.map(|t| tokio::time::Instant::now() + t);
    let mut kill_rx = ctl.kill.subscribe();
    let mut pending = kill_rx.borrow_and_update().clone();
    let mut timed_out = false;
    let mut kill_open = true;
    loop {
        if let (Some(signal), Some(pid)) = (pending.take(), pid) {
            let _ = kill_tree(pid, &signal);
        }
        let sleep = async {
            match deadline {
                Some(at) => tokio::time::sleep_until(at).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            status = child.wait() => return status,
            _ = sleep, if !timed_out => {
                timed_out = true;
                pending = Some(opts.timeout_signal.clone());
            }
            changed = kill_rx.changed(), if kill_open => match changed {
                Ok(()) => pending = kill_rx.borrow_and_update().clone(),
                Err(_) => kill_open = false,
            },
        }
    }
}

async fn read_stream<R: AsyncRead + Unpin>(
    reader: Option<R>,
    is_stderr: bool,
    store: &Mutex<Store>,
    tap: Option<&Tap>,
    log: bool,
) {
    let Some(mut reader) = reader else { return };
    let mut buf = vec![0u8; 8192];
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let chunk = &buf[..n];
        {
            let mut store = store.lock().unwrap_or_else(|e| e.into_inner());
            if is_stderr {
                store.stderr.extend_from_slice(chunk);
            } else {
                store.stdout.extend_from_slice(chunk);
            }
            store.stdall.extend_from_slice(chunk);
        }
        if let Some(tap) = tap {
            let wanted = match tap.from {
                PipeFrom::Stdout => !is_stderr,
                PipeFrom::Stderr => is_stderr,
                PipeFrom::Stdall => true,
            };
            if wanted {
                let _ = tap.tx.send(chunk.to_vec());
            }
        }
        if log {
            log_bytes(chunk);
        }
    }
}
