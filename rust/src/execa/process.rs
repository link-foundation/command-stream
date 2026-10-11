use super::result::strip_final_newline;
use super::{CancelSignal, ExecaCommand, ExecaError, ExecaOutcome, ExecaResult, Options};
use crate::{OutputChunk, OutputStream, StreamingRunner};
use std::future::pending;
use std::time::Instant;
use tokio::task::JoinHandle;
use tokio::time::{sleep_until, Instant as TokioInstant};

/// Live output and process control. Dropping the handle requests termination.
pub struct Subprocess {
    stream: OutputStream,
    task: JoinHandle<crate::Result<()>>,
    options: Options,
    result: ExecaResult,
    started: Instant,
    deadline: Option<TokioInstant>,
    stopped: bool,
}

impl Subprocess {
    pub(crate) fn new(command: ExecaCommand) -> Self {
        let options = command.options;
        let display: Vec<_> = std::iter::once(&command.file)
            .chain(&command.args)
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let escaped_command = display
            .iter()
            .map(|arg| crate::quote(arg))
            .collect::<Vec<_>>()
            .join(" ");
        let mut runner = StreamingRunner::from_argv(command.file, command.args)
            .env(options.env.clone())
            .clear_env(!options.extend_env)
            .prefer_local(options.prefer_local.clone())
            .kill_signal(options.kill_signal.clone());
        if let Some(cwd) = &options.cwd {
            runner = runner.cwd(cwd);
        }
        if let Some(input) = &options.input {
            runner = runner.stdin_bytes(input.clone());
        }
        let (stream, task) = runner.spawn();
        crate::trace::trace_lazy("Execa", || "Started exact-argv command".to_string());
        Self {
            stream,
            task,
            deadline: options.timeout.map(|timeout| TokioInstant::now() + timeout),
            result: ExecaResult {
                command: display.join(" "),
                escaped_command,
                all: options.all.then(Vec::new),
                ..ExecaResult::default()
            },
            options,
            started: Instant::now(),
            stopped: false,
        }
    }

    pub fn pid(&self) -> Option<u32> {
        self.stream.pid()
    }

    pub async fn wait_for_pid(&mut self) -> Option<u32> {
        self.stream.wait_for_pid().await
    }

    pub fn kill(&mut self, signal: &str) {
        if !self.stopped {
            self.stopped = true;
            self.result.killed = true;
            self.stream.kill_with(signal);
        }
    }

    /// Read a typed chunk and retain it for `wait()` unless buffering is off.
    pub async fn next(&mut self) -> Option<OutputChunk> {
        loop {
            let deadline = if self.stopped { None } else { self.deadline };
            tokio::select! {
                chunk = self.stream.next() => {
                    if let Some(chunk) = &chunk { self.capture(chunk); }
                    return chunk;
                }
                _ = wait_deadline(deadline) => {
                    self.result.timed_out = true;
                    self.kill(&self.options.kill_signal.clone());
                }
                _ = wait_cancel(&mut self.options.cancel_signal), if !self.stopped => {
                    self.result.is_canceled = true;
                    self.kill(&self.options.kill_signal.clone());
                }
            }
        }
    }

    fn capture(&mut self, chunk: &OutputChunk) {
        let (data, destination) = match chunk {
            OutputChunk::Stdout(data) => (data, &mut self.result.stdout),
            OutputChunk::Stderr(data) => (data, &mut self.result.stderr),
            OutputChunk::Exit(code) => {
                self.result.exit_code = Some(*code);
                return;
            }
        };
        if !self.options.buffer {
            return;
        }
        let remaining = self.options.max_buffer.saturating_sub(destination.len());
        destination.extend_from_slice(&data[..data.len().min(remaining)]);
        if let Some(all) = &mut self.result.all {
            let remaining = self
                .options
                .max_buffer
                .saturating_mul(2)
                .saturating_sub(all.len());
            all.extend_from_slice(&data[..data.len().min(remaining)]);
        }
        if data.len() > remaining {
            self.result.is_max_buffer = true;
            self.kill(&self.options.kill_signal.clone());
        }
    }

    /// Drain remaining output and wait for the process and its output pumps.
    pub async fn wait(mut self) -> ExecaOutcome {
        while self.next().await.is_some() {}
        match (&mut self.task).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => self.result.cause = Some(error.to_string()),
            Err(error) => self.result.cause = Some(error.to_string()),
        }
        self.result.signal = self.stream.exit_signal();
        if self.result.signal.is_some() {
            self.result.exit_code = None;
        }
        self.result.duration = self.started.elapsed();
        self.result.failed = self.result.exit_code != Some(0)
            || self.result.killed
            || self.result.timed_out
            || self.result.is_canceled
            || self.result.is_max_buffer
            || self.result.cause.is_some();
        if self.options.strip_final_newline {
            strip_final_newline(&mut self.result.stdout);
            strip_final_newline(&mut self.result.stderr);
            if let Some(all) = &mut self.result.all {
                strip_final_newline(all);
            }
        }
        crate::trace::trace_lazy("Execa", || {
            format!("Finished | failed={}", self.result.failed)
        });
        if self.options.reject && self.result.failed {
            Err(ExecaError {
                result: Box::new(self.result),
            })
        } else {
            Ok(self.result)
        }
    }
}

async fn wait_deadline(deadline: Option<TokioInstant>) {
    match deadline {
        Some(deadline) => sleep_until(deadline).await,
        None => pending().await,
    }
}

async fn wait_cancel(signal: &mut Option<CancelSignal>) {
    if let Some(signal) = signal {
        if signal.0.wait_for(|canceled| *canceled).await.is_ok() {
            return;
        }
    }
    pending().await
}
