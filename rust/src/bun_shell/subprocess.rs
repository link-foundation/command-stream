//! External command execution: Bun's `ShellSubprocess`
//! (`src/runtime/shell/subproc.rs`) and the subprocess half of the `Cmd`
//! state (`states/Cmd.rs`) (MIT, Copyright (c) Oven-sh / Jarred Sumner),
//! ported by way of `js/src/bun-shell/subprocess.mjs`.
//!
//! The child gets real OS handles wherever possible: redirect files and the
//! process stdout/stderr are passed as duplicated handles, everything else
//! goes through OS pipes that this module drains:
//!
//! - an `Fd` output with a `captured` buffer (the non-quiet root
//!   stdout/stderr) is teed: every chunk goes to the writer and to a buffer
//!   that is appended to `captured` when the child is done;
//! - an `Fd` output whose writer is a pipeline [`Channel`](super::io::Channel)
//!   is pumped into the channel with backpressure; once the reader is gone
//!   the pipe is closed, so the child's next write raises SIGPIPE (exit code
//!   141) like it would in Bun;
//! - a `Pipe` output is buffered and appended to the shell env's buffered
//!   stdout/stderr;
//! - `> ${buf}` fills the [`OutBuffer`] and silently drops the overflow;
//! - `2>&1` / `1>&2` without a file give both fds the same pipe writer, so
//!   the interleaving is exactly the child's.
//!
//! Stdin comes from a file handle, the inherited process stdin, `< ${bytes}`
//! (fed through a pipe) or a pipeline channel (pumped until the child exits).

use std::fs::File;
use std::io;
use std::process::Stdio;
use std::sync::Arc;

use tokio::io::AsyncWriteExt;
use tokio::process::{ChildStdin, Command};

use super::io::{
    dup_process_stdio, redirects_elsewhere, InKind, OutKind, Reader, ReaderSource, SharedBuf,
    ShellIO, ShellSysError, Which, Writer,
};
use super::OutBuffer;

/// A stdin redirect of the command.
#[derive(Debug)]
pub(crate) enum InOverride {
    /// `< file`: an opened file.
    File(Arc<File>),
    /// `< ${bytes}` / `< ${blob}`.
    Bytes(Vec<u8>),
}

/// A stdout/stderr redirect of the command.
#[derive(Debug)]
pub(crate) enum OutOverride {
    /// `> file` / `>> file`: an opened file.
    File(Arc<File>),
    /// `> ${buf}`: a fixed-size buffer; the overflow is dropped.
    Buffer(OutBuffer),
}

/// The command's own redirect targets (the JS `redirectOverridesForFd`).
#[derive(Debug, Default)]
pub(crate) struct Overrides {
    pub(crate) stdin: Option<InOverride>,
    pub(crate) stdout: Option<OutOverride>,
    pub(crate) stderr: Option<OutOverride>,
}

/// `2>&1` / `1>&2` without a file (Bun's `Stdio::Dup2`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Dup {
    StderrToStdout,
    StdoutToStderr,
}

/// Everything [`run_subprocess`] needs.
pub(crate) struct SubprocessOptions<'a> {
    /// `args[0]` is the resolved executable.
    pub(crate) args: Vec<String>,
    pub(crate) cwd: &'a str,
    /// The complete child environment (see `ShellExecEnv::child_env`).
    pub(crate) env: Vec<(String, String)>,
    /// The command's IO.
    pub(crate) io: &'a ShellIO,
    /// The command's `RedirectFlags`.
    pub(crate) flags: u8,
    pub(crate) overrides: Overrides,
    pub(crate) dup: Option<Dup>,
    /// The shell env's buffered stdout/stderr (targets of `Pipe` outputs).
    pub(crate) buffered_stdout: SharedBuf,
    pub(crate) buffered_stderr: SharedBuf,
}

/// How a subprocess ended.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SubprocessResult {
    /// The exit code: the child's, `128 + signal` when it was killed, or the
    /// errno of a failed write to a teed output.
    Exited(i32),
    /// The child could not be started; the error's path is `args[0]`.
    SpawnError(ShellSysError),
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/// Where a piped output's bytes go.
enum Sink {
    /// Bun's `BufferedOutput::Bytelist`.
    Buffer(Vec<u8>),
    /// Bun's `BufferedOutput::ArrayBuffer`: truncates on overflow.
    View { buf: OutBuffer, pos: usize },
    /// Bun's `Capture`: buffered and teed to `writer`; a failed write is
    /// reported as the exit code.
    Tee {
        writer: Writer,
        buf: Vec<u8>,
        err: Option<ShellSysError>,
    },
    /// A pipeline channel, with backpressure.
    Writer(Writer),
}

impl Sink {
    /// What is appended to the capture buffer once the child is done.
    fn slice(&self) -> Option<Vec<u8>> {
        match self {
            Sink::Buffer(b) | Sink::Tee { buf: b, .. } => Some(b.clone()),
            Sink::View { buf, .. } => Some(buf.contents()),
            Sink::Writer(_) => None,
        }
    }

    fn err(&self) -> Option<&ShellSysError> {
        match self {
            Sink::Tee { err, .. } => err.as_ref(),
            _ => None,
        }
    }
}

enum OutPlan {
    File(File),
    Inherit,
    Null,
    Pipe {
        sink: Sink,
        capture: Option<SharedBuf>,
    },
}

enum InPlan {
    File(File),
    Inherit,
    Null,
    Bytes(Vec<u8>),
    Reader(Reader),
}

fn plan_out(
    out: &OutKind,
    ov: Option<OutOverride>,
    buffered: &SharedBuf,
    elsewhere: bool,
) -> io::Result<OutPlan> {
    match ov {
        Some(OutOverride::File(f)) => return Ok(OutPlan::File(f.try_clone()?)),
        Some(OutOverride::Buffer(buf)) => {
            let capture = match out {
                _ if elsewhere => None,
                OutKind::Fd { captured, .. } => captured.clone(),
                OutKind::Pipe => Some(buffered.clone()),
                OutKind::Ignore => None,
            };
            return Ok(OutPlan::Pipe {
                sink: Sink::View { buf, pos: 0 },
                capture,
            });
        }
        None => {}
    }
    Ok(match out {
        OutKind::Fd {
            writer,
            captured: Some(captured),
        } => OutPlan::Pipe {
            sink: Sink::Tee {
                writer: writer.clone(),
                buf: Vec::new(),
                err: None,
            },
            capture: (!elsewhere).then(|| captured.clone()),
        },
        OutKind::Fd {
            writer,
            captured: None,
        } => match writer.try_clone_file() {
            Some(Ok(f)) => OutPlan::File(f),
            Some(Err(_)) => OutPlan::Inherit,
            None => OutPlan::Pipe {
                sink: Sink::Writer(writer.clone()),
                capture: None,
            },
        },
        OutKind::Pipe => OutPlan::Pipe {
            sink: Sink::Buffer(Vec::new()),
            capture: (!elsewhere).then(|| buffered.clone()),
        },
        OutKind::Ignore => OutPlan::Null,
    })
}

fn plan_in(input: &InKind, ov: Option<InOverride>) -> io::Result<InPlan> {
    match ov {
        Some(InOverride::File(f)) => return Ok(InPlan::File(f.try_clone()?)),
        Some(InOverride::Bytes(b)) if b.is_empty() => return Ok(InPlan::Null),
        Some(InOverride::Bytes(b)) => return Ok(InPlan::Bytes(b)),
        None => {}
    }
    let InKind::Fd(reader) = input else {
        return Ok(InPlan::Null);
    };
    Ok(match reader.source() {
        ReaderSource::File(_) => match reader.try_clone_file() {
            Some(r) => InPlan::File(r?),
            None => InPlan::Null,
        },
        ReaderSource::Stdin => InPlan::Inherit,
        ReaderSource::Channel(_) => InPlan::Reader(reader.clone()),
    })
}

/// A piped output being drained.
struct Drain {
    pipe: PipeReader,
    sink: Sink,
    capture: Option<SharedBuf>,
}

/// Turn an output plan into the child's stdio (and a drain for pipes).
fn materialize_out(plan: OutPlan) -> io::Result<(Stdio, Option<Drain>, Option<io::PipeWriter>)> {
    Ok(match plan {
        OutPlan::File(f) => (Stdio::from(f), None, None),
        OutPlan::Inherit => (Stdio::inherit(), None, None),
        OutPlan::Null => (Stdio::null(), None, None),
        OutPlan::Pipe { sink, capture } => {
            let (r, w) = io::pipe()?;
            let for_dup = w.try_clone()?;
            (
                Stdio::from(w),
                Some(Drain {
                    pipe: PipeReader::new(r)?,
                    sink,
                    capture,
                }),
                Some(for_dup),
            )
        }
    })
}

/// The stdio of the dup source (`from`) given the target's plan.
fn dup_stdio(
    target: &OutPlan,
    target_which: Which,
    shared: Option<io::PipeWriter>,
) -> io::Result<Stdio> {
    Ok(match target {
        OutPlan::Pipe { .. } => match shared {
            Some(w) => Stdio::from(w),
            None => Stdio::null(),
        },
        OutPlan::File(f) => Stdio::from(f.try_clone()?),
        OutPlan::Inherit => match dup_process_stdio(target_which) {
            Ok(f) => Stdio::from(f),
            Err(_) => Stdio::inherit(),
        },
        OutPlan::Null => Stdio::null(),
    })
}

// ---------------------------------------------------------------------------
// Pipe reading
// ---------------------------------------------------------------------------

/// The read end of an output pipe, read asynchronously. Dropping it closes
/// the pipe (a child writing to it then gets SIGPIPE / EPIPE).
enum PipeReader {
    #[cfg(unix)]
    Async(tokio::net::unix::pipe::Receiver),
    /// Read by a helper thread (Windows; also used on unix when the pipe
    /// cannot be registered with the reactor).
    Thread(tokio::sync::mpsc::Receiver<io::Result<Vec<u8>>>),
}

impl PipeReader {
    fn new(r: io::PipeReader) -> io::Result<Self> {
        #[cfg(unix)]
        let reader = {
            use std::os::fd::OwnedFd;
            let fd = OwnedFd::from(r);
            match tokio::net::unix::pipe::Receiver::from_owned_fd(fd.try_clone()?) {
                Ok(rx) => Ok(PipeReader::Async(rx)),
                Err(_) => Self::threaded(File::from(fd)),
            }
        };
        #[cfg(not(unix))]
        let reader = Self::threaded(r);
        reader
    }

    fn threaded(mut r: impl io::Read + Send + 'static) -> io::Result<Self> {
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        std::thread::Builder::new()
            .name("bun-shell-pipe".into())
            .spawn(move || loop {
                let mut buf = vec![0u8; super::io::READ_CHUNK];
                let res = match r.read(&mut buf) {
                    Ok(0) => return,
                    Ok(n) => {
                        buf.truncate(n);
                        Ok(buf)
                    }
                    Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                    Err(e) => Err(e),
                };
                let failed = res.is_err();
                if tx.blocking_send(res).is_err() || failed {
                    return;
                }
            })?;
        Ok(PipeReader::Thread(rx))
    }

    /// The next chunk; `None` at EOF (a read error also ends the stream,
    /// Windows reports the end of a pipe as a broken pipe).
    async fn next(&mut self) -> Option<Vec<u8>> {
        match self {
            #[cfg(unix)]
            PipeReader::Async(rx) => {
                use tokio::io::AsyncReadExt;
                let mut buf = vec![0u8; super::io::READ_CHUNK];
                loop {
                    match rx.read(&mut buf).await {
                        Ok(0) => return None,
                        Ok(n) => {
                            buf.truncate(n);
                            return Some(buf);
                        }
                        Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                        Err(_) => return None,
                    }
                }
            }
            PipeReader::Thread(rx) => rx.recv().await.and_then(Result::ok),
        }
    }
}

/// Drain one output pipe into its sink until EOF.
async fn drain(mut d: Drain) -> Drain {
    while let Some(chunk) = d.pipe.next().await {
        match &mut d.sink {
            Sink::Buffer(b) => b.extend_from_slice(&chunk),
            Sink::View { buf, pos } => buf.with(|view| {
                if *pos < view.len() {
                    let n = (view.len() - *pos).min(chunk.len());
                    view[*pos..*pos + n].copy_from_slice(&chunk[..n]);
                    *pos += n;
                }
            }),
            Sink::Tee { writer, buf, err } => {
                buf.extend_from_slice(&chunk);
                if let Err(e) = writer.write(&chunk, None).await {
                    err.get_or_insert(e);
                }
            }
            Sink::Writer(w) => {
                if w.write(&chunk, None).await.is_err() {
                    // The reader is gone: close our end so the child's next
                    // write fails with SIGPIPE, like a real pipeline.
                    d.pipe = PipeReader::Thread(tokio::sync::mpsc::channel(1).1);
                    break;
                }
            }
        }
    }
    d
}

/// Feed the child's stdin; returns when the input is exhausted (the pipe is
/// then closed) or the child stopped reading.
async fn feed_stdin(stdin: Option<ChildStdin>, plan: Option<InPlan>) {
    let Some(mut stdin) = stdin else {
        return;
    };
    match plan {
        Some(InPlan::Bytes(bytes)) => {
            let _ = stdin.write_all(&bytes).await;
        }
        Some(InPlan::Reader(reader)) => {
            while let Ok(Some(chunk)) = reader.read_chunk().await {
                if stdin.write_all(&chunk).await.is_err() {
                    return;
                }
            }
        }
        _ => {}
    }
    let _ = stdin.shutdown().await;
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/// Whether JavaScript's `\s` matches `c`.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0b}' | '\u{0c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// Quote an argument for a `cmd.exe /s /c "..."` line (the JS
/// `quoteWindowsArg`).
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.chars().any(|c| is_js_space(c) || c == '"') {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => {
                backslashes += 1;
                continue;
            }
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2));
                out.push_str("\\\"");
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
            }
        }
        backslashes = 0;
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// Whether `argv0` is a batch file (run through `cmd.exe` on Windows).
pub(crate) fn is_batch_file(argv0: &str) -> bool {
    let lower = argv0.to_ascii_lowercase();
    lower.ends_with(".bat") || lower.ends_with(".cmd")
}

/// The `cmd.exe` line for a batch file: `/d /s /c "<quoted argv>"`.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) fn batch_command_line(args: &[String]) -> String {
    let line: Vec<String> = args.iter().map(|a| quote_windows_arg(a)).collect();
    format!("\"{}\"", line.join(" "))
}

fn build_command(args: &[String]) -> Command {
    #[cfg(windows)]
    {
        if is_batch_file(&args[0]) {
            let comspec = std::env::var("ComSpec")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "cmd.exe".to_string());
            let mut cmd = Command::new(comspec);
            cmd.raw_arg("/d")
                .raw_arg("/s")
                .raw_arg("/c")
                .raw_arg(batch_command_line(args));
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            return cmd;
        }
        let mut cmd = Command::new(&args[0]);
        cmd.args(&args[1..]);
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(&args[0]);
        cmd.args(&args[1..]);
        cmd
    }
}

fn exit_code_of(status: io::Result<std::process::ExitStatus>) -> i32 {
    let Ok(status) = status else {
        return 1;
    };
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
    1
}

/// Spawn `opts.args` and wait until it has exited and its output pipes are
/// closed, then append the captured output (stdout first) to its buffers.
pub(crate) async fn run_subprocess(opts: SubprocessOptions<'_>) -> SubprocessResult {
    let SubprocessOptions {
        args,
        cwd,
        env,
        io,
        flags,
        overrides,
        dup,
        buffered_stdout,
        buffered_stderr,
    } = opts;
    let argv0 = args.first().cloned().unwrap_or_default();
    let spawn_err =
        |e: &io::Error| SubprocessResult::SpawnError(ShellSysError::from_io(e, argv0.clone()));
    if args.is_empty() {
        return spawn_err(&io::Error::from(io::ErrorKind::NotFound));
    }

    let Overrides {
        stdin: ov_in,
        stdout: ov_out,
        stderr: ov_err,
    } = overrides;
    let plans = (|| -> io::Result<_> {
        Ok((
            plan_in(&io.stdin, ov_in)?,
            plan_out(
                &io.stdout,
                ov_out,
                &buffered_stdout,
                redirects_elsewhere(flags, Which::Stdout),
            )?,
            plan_out(
                &io.stderr,
                ov_err,
                &buffered_stderr,
                redirects_elsewhere(flags, Which::Stderr),
            )?,
        ))
    })();
    let (in_plan, out_plan, err_plan) = match plans {
        Ok(p) => p,
        Err(e) => return spawn_err(&e),
    };

    let mut cmd = build_command(&args);
    cmd.current_dir(cwd)
        .env_clear()
        .envs(env)
        .kill_on_drop(false);

    let stdin_plan = match in_plan {
        InPlan::File(f) => {
            cmd.stdin(Stdio::from(f));
            None
        }
        InPlan::Inherit => {
            cmd.stdin(Stdio::inherit());
            None
        }
        InPlan::Null => {
            cmd.stdin(Stdio::null());
            None
        }
        p @ (InPlan::Bytes(_) | InPlan::Reader(_)) => {
            cmd.stdin(Stdio::piped());
            Some(p)
        }
    };

    let outputs = (|| -> io::Result<_> {
        Ok(match dup {
            None => {
                let (out, d_out, _) = materialize_out(out_plan)?;
                let (err, d_err, _) = materialize_out(err_plan)?;
                (out, err, d_out, d_err)
            }
            // 2>&1: stderr joins stdout.
            Some(Dup::StderrToStdout) => {
                let err = dup_stdio(&out_plan, Which::Stdout, None)?;
                let (out, d_out, shared) = materialize_out(out_plan)?;
                let err = shared.map_or(err, Stdio::from);
                (out, err, d_out, None)
            }
            // 1>&2: stdout joins stderr.
            Some(Dup::StdoutToStderr) => {
                let out = dup_stdio(&err_plan, Which::Stderr, None)?;
                let (err, d_err, shared) = materialize_out(err_plan)?;
                let out = shared.map_or(out, Stdio::from);
                (out, err, None, d_err)
            }
        })
    })();
    let (out_stdio, err_stdio, d_out, d_err) = match outputs {
        Ok(o) => o,
        Err(e) => return spawn_err(&e),
    };
    cmd.stdout(out_stdio).stderr(err_stdio);

    let spawned = cmd.spawn();
    // Drop our copies of the child's pipe ends so EOF arrives when it exits.
    drop(cmd);
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return spawn_err(&e),
    };

    let stdin = child.stdin.take();
    let wait = async {
        let feed = feed_stdin(stdin, stdin_plan);
        tokio::pin!(feed);
        tokio::select! {
            status = child.wait() => status,
            () = &mut feed => child.wait().await,
        }
    };
    let drain_opt = |d: Option<Drain>| async move {
        match d {
            Some(d) => Some(drain(d).await),
            None => None,
        }
    };
    let (status, d_out, d_err) = tokio::join!(wait, drain_opt(d_out), drain_opt(d_err));

    let mut exit_code = exit_code_of(status);
    for d in [d_out, d_err].into_iter().flatten() {
        if let Some(e) = d.sink.err() {
            exit_code = e.errno;
        }
        if let (Some(capture), Some(bytes)) = (&d.capture, d.sink.slice()) {
            capture.append(&bytes);
        }
    }
    SubprocessResult::Exited(exit_code)
}

#[cfg(test)]
mod tests;
