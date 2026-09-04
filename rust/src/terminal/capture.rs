use super::artifacts::{unroll_terminal_frames, write_terminal_artifacts};
use super::types::{
    Asciicast, AsciicastEvent, AsciicastHeader, TerminalCapture, TerminalCaptureError,
    TerminalCaptureOptions, TerminalCursor, TerminalFrame, TerminalInteraction, TerminalResize,
};
use portable_pty::{native_pty_system, Child, CommandBuilder, ExitStatus, MasterPty, PtySize};
use regex::Regex;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const ERASE_SCREEN: &[u8] = b"\x1b[2J";

fn elapsed(started: Instant) -> f64 {
    (started.elapsed().as_secs_f64() * 1_000_000.0).round() / 1_000_000.0
}

fn trim_trailing_blank(mut lines: Vec<String>) -> Vec<String> {
    while lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    lines
}

fn frame(parser: &vt100::Parser, started: Instant) -> TerminalFrame {
    let screen = parser.screen();
    let (rows, cols) = screen.size();
    let (cursor_y, cursor_x) = screen.cursor_position();
    let lines = trim_trailing_blank(screen.rows(0, cols).collect());
    TerminalFrame {
        time: elapsed(started),
        cols,
        rows,
        cursor: TerminalCursor {
            x: cursor_x,
            y: cursor_y,
        },
        alternate: screen.alternate_screen(),
        screen: lines.clone(),
        lines,
    }
}

fn same_frame(left: &TerminalFrame, right: &TerminalFrame) -> bool {
    left.cols == right.cols
        && left.rows == right.rows
        && left.cursor == right.cursor
        && left.alternate == right.alternate
        && left.lines == right.lines
}

fn append_frame(frames: &mut Vec<TerminalFrame>, parser: &vt100::Parser, started: Instant) {
    let next = frame(parser, started);
    if frames
        .last()
        .is_none_or(|previous| !same_frame(previous, &next))
    {
        frames.push(next);
    }
}

fn render_segments(data: &[u8]) -> Vec<&[u8]> {
    let positions = data
        .windows(ERASE_SCREEN.len())
        .enumerate()
        .filter_map(|(index, window)| (window == ERASE_SCREEN).then_some(index))
        .collect::<Vec<_>>();
    if positions.is_empty() {
        return vec![data];
    }

    let mut segments = Vec::new();
    if positions[0] > 0 {
        segments.push(&data[..positions[0]]);
    }
    for (index, position) in positions.iter().enumerate() {
        let end = positions.get(index + 1).copied().unwrap_or(data.len());
        segments.push(&data[*position..end]);
    }
    segments
}

fn drain_complete_render_data(pending: &mut Vec<u8>) -> Vec<u8> {
    let maximum = pending.len().min(ERASE_SCREEN.len() - 1);
    let pending_length = (1..=maximum)
        .rev()
        .find(|length| ERASE_SCREEN.starts_with(&pending[pending.len() - length..]))
        .unwrap_or(0);
    pending.drain(..pending.len() - pending_length).collect()
}

fn record(asciicast: &mut Asciicast, started: Instant, code: &str, data: impl Into<String>) {
    asciicast.events.push(AsciicastEvent {
        time: elapsed(started),
        code: code.into(),
        data: data.into(),
    });
}

fn apply_interaction(
    interaction: &TerminalInteraction,
    writer: &mut dyn Write,
    master: &dyn MasterPty,
    parser: &mut vt100::Parser,
    asciicast: &mut Asciicast,
    started: Instant,
) -> Result<(), TerminalCaptureError> {
    if let Some(text) = &interaction.text {
        writer
            .write_all(text.as_bytes())
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        writer
            .flush()
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        record(asciicast, started, "i", text.clone());
    }
    if let Some(key) = &interaction.key {
        writer
            .write_all(key.sequence().as_bytes())
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        writer
            .flush()
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        record(asciicast, started, "i", key.sequence());
    }
    if let Some(resize) = interaction.resize {
        resize_terminal(master, parser, resize)?;
        record(
            asciicast,
            started,
            "r",
            format!("{}x{}", resize.cols, resize.rows),
        );
    }
    Ok(())
}

fn resize_terminal(
    master: &dyn MasterPty,
    parser: &mut vt100::Parser,
    resize: TerminalResize,
) -> Result<(), TerminalCaptureError> {
    master
        .resize(PtySize {
            rows: resize.rows,
            cols: resize.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
    parser.set_size(resize.rows, resize.cols);
    Ok(())
}

fn asciicast(options: &TerminalCaptureOptions) -> Asciicast {
    let mut env = HashMap::new();
    env.insert("SHELL".into(), options.file.clone());
    env.insert(
        "TERM".into(),
        options
            .env
            .get("TERM")
            .cloned()
            .unwrap_or_else(|| "xterm-256color".into()),
    );
    Asciicast {
        header: AsciicastHeader {
            version: 2,
            width: options.cols,
            height: options.rows,
            timestamp: chrono::Utc::now().timestamp(),
            env,
        },
        events: Vec::new(),
    }
}

fn spawn_reader(mut reader: Box<dyn Read + Send>) -> mpsc::Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    if sender.send(buffer[..length].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    receiver
}

fn capture_result(
    status: portable_pty::ExitStatus,
    output: String,
    frames: Vec<TerminalFrame>,
    interaction_count: usize,
    asciicast: Asciicast,
) -> TerminalCapture {
    TerminalCapture {
        exit_code: status.exit_code() as i32,
        signal: status.signal().map(str::to_owned),
        transcript: unroll_terminal_frames(&frames),
        output,
        frames,
        interaction_count,
        asciicast,
    }
}

/// Readiness condition for [`TerminalSession::wait_for`], mirroring the
/// `after` / `after_regex` vocabulary of [`TerminalInteraction`].
#[derive(Debug, Clone)]
pub enum TerminalPattern {
    Text(String),
    Regex(Regex),
}

impl TerminalPattern {
    pub fn text(value: impl Into<String>) -> Self {
        Self::Text(value.into())
    }

    pub fn regex(pattern: &str) -> Result<Self, TerminalCaptureError> {
        Regex::new(pattern).map(Self::Regex).map_err(|error| {
            TerminalCaptureError::new(format!("invalid terminal pattern regex: {error}"), None)
        })
    }

    fn matches(&self, output: &str) -> bool {
        match self {
            Self::Text(value) => output.contains(value),
            Self::Regex(pattern) => pattern.is_match(output),
        }
    }
}

/// A pseudoterminal that stays open until the caller closes it, so input may be
/// sent long after the process started.
pub struct TerminalSession {
    options: TerminalCaptureOptions,
    interaction_regexes: Vec<Option<Regex>>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    receiver: mpsc::Receiver<Vec<u8>>,
    started: Instant,
    parser: vt100::Parser,
    recording: Asciicast,
    output: String,
    frames: Vec<TerminalFrame>,
    pending_render: Vec<u8>,
    terminal_has_output: bool,
    interaction_index: usize,
    last_output: Option<Instant>,
    dirty: bool,
    reader_closed: bool,
    status: Option<ExitStatus>,
    timed_out: bool,
    stop_deadline: Option<Instant>,
}

impl TerminalSession {
    fn open(options: TerminalCaptureOptions) -> Result<Self, TerminalCaptureError> {
        if options.file.is_empty() {
            return Err(TerminalCaptureError::new(
                "open_terminal requires a file",
                None,
            ));
        }
        let interaction_regexes = options
            .interactions
            .iter()
            .map(|interaction| {
                interaction
                    .after_regex
                    .as_ref()
                    .map(|pattern| {
                        Regex::new(pattern).map_err(|error| {
                            TerminalCaptureError::new(
                                format!("invalid terminal interaction regex: {error}"),
                                None,
                            )
                        })
                    })
                    .transpose()
            })
            .collect::<Result<Vec<_>, _>>()?;
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: options.rows,
                cols: options.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        let mut command = CommandBuilder::new(&options.file);
        command.args(&options.args);
        if let Some(cwd) = &options.cwd {
            command.cwd(cwd);
        }
        command.env(
            "TERM",
            options
                .env
                .get("TERM")
                .map_or("xterm-256color", String::as_str),
        );
        for (name, value) in &options.env {
            command.env(name, value);
        }
        let child = pty
            .slave
            .spawn_command(command)
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        drop(pty.slave);
        let reader = pty
            .master
            .try_clone_reader()
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        let writer = pty
            .master
            .take_writer()
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        let receiver = spawn_reader(reader);
        let recording = asciicast(&options);
        let parser = vt100::Parser::new(options.rows, options.cols, 100_000);
        Ok(Self {
            interaction_regexes,
            master: pty.master,
            writer,
            child,
            receiver,
            started: Instant::now(),
            parser,
            recording,
            output: String::new(),
            frames: Vec::new(),
            pending_render: Vec::new(),
            terminal_has_output: false,
            interaction_index: 0,
            last_output: None,
            dirty: false,
            reader_closed: false,
            status: None,
            timed_out: false,
            stop_deadline: None,
            options,
        })
    }

    /// Raw PTY output seen so far.
    pub fn output(&self) -> &str {
        &self.output
    }

    /// Settled states retained so far.
    pub fn frames(&self) -> &[TerminalFrame] {
        &self.frames
    }

    /// Unrolled transcript of the states retained so far.
    pub fn transcript(&self) -> String {
        unroll_terminal_frames(&self.frames)
    }

    /// Whether the child is still alive.
    pub fn running(&self) -> bool {
        self.status.is_none()
    }

    fn read_available(&mut self) {
        match self.receiver.recv_timeout(Duration::from_millis(5)) {
            Ok(data) => {
                let text = String::from_utf8_lossy(&data);
                self.output.push_str(&text);
                record(&mut self.recording, self.started, "o", text.into_owned());
                self.pending_render.extend_from_slice(&data);
                let render_data = drain_complete_render_data(&mut self.pending_render);
                let segments = render_segments(&render_data);
                let segment_count = segments.len();
                if self.terminal_has_output && render_data.starts_with(ERASE_SCREEN) {
                    append_frame(&mut self.frames, &self.parser, self.started);
                }
                for (index, segment) in segments.into_iter().enumerate() {
                    self.parser.process(segment);
                    self.terminal_has_output |= !segment.is_empty();
                    if index + 1 < segment_count {
                        append_frame(&mut self.frames, &self.parser, self.started);
                    }
                }
                self.last_output = Some(Instant::now());
                self.dirty = true;
                if self
                    .options
                    .stop_marker
                    .as_ref()
                    .is_some_and(|marker| self.output.contains(marker))
                    && self.stop_deadline.is_none()
                {
                    append_frame(&mut self.frames, &self.parser, self.started);
                    self.stop_deadline = Some(Instant::now() + self.options.stop_marker_grace);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => self.reader_closed = true,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }

    fn idle_for(&self) -> Duration {
        self.last_output
            .map_or_else(|| self.started.elapsed(), |instant| instant.elapsed())
    }

    fn apply_scripted_interactions(&mut self) -> Result<(), TerminalCaptureError> {
        while let Some(interaction) = self.options.interactions.get(self.interaction_index) {
            if interaction
                .after
                .as_ref()
                .is_some_and(|marker| !self.output.contains(marker))
            {
                break;
            }
            if self.interaction_regexes[self.interaction_index]
                .as_ref()
                .is_some_and(|pattern| !pattern.is_match(&self.output))
            {
                break;
            }
            if interaction.idle_duration > Duration::ZERO
                && self.idle_for() < interaction.idle_duration
            {
                break;
            }
            let interaction = interaction.clone();
            append_frame(&mut self.frames, &self.parser, self.started);
            apply_interaction(
                &interaction,
                self.writer.as_mut(),
                self.master.as_ref(),
                &mut self.parser,
                &mut self.recording,
                self.started,
            )?;
            self.interaction_index += 1;
        }
        Ok(())
    }

    /// Advance the capture by one step: read pending output, apply any scripted
    /// interaction whose readiness condition became true, retain settled states,
    /// and enforce the optional deadline.
    fn poll(&mut self) -> Result<(), TerminalCaptureError> {
        self.read_available();
        self.apply_scripted_interactions()?;

        if self.dirty
            && self
                .last_output
                .is_some_and(|instant| instant.elapsed() >= self.options.settle_duration)
        {
            append_frame(&mut self.frames, &self.parser, self.started);
            self.dirty = false;
        }
        if self.status.is_none() {
            self.status = self
                .child
                .try_wait()
                .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        }
        if self.status.is_none() {
            let expired = self
                .options
                .timeout
                .is_some_and(|timeout| self.started.elapsed() >= timeout);
            let stopped = self
                .stop_deadline
                .is_some_and(|deadline| Instant::now() >= deadline);
            if expired || stopped {
                self.timed_out = expired;
                self.stop()?;
            }
        }
        Ok(())
    }

    fn finished(&self) -> bool {
        self.status.is_some() && self.reader_closed
    }

    fn stop(&mut self) -> Result<(), TerminalCaptureError> {
        let _ = self.child.kill();
        self.status = Some(
            self.child
                .wait()
                .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?,
        );
        Ok(())
    }

    /// Block until `pattern` has been seen and, when `idle` is non-zero, no
    /// further output arrived for that long. New output restarts the idle wait.
    pub fn wait_for(
        &mut self,
        pattern: &TerminalPattern,
        idle: Duration,
        timeout: Option<Duration>,
    ) -> Result<(), TerminalCaptureError> {
        let deadline = timeout.map(|limit| Instant::now() + limit);
        loop {
            if pattern.matches(&self.output) && self.idle_for() >= idle {
                return Ok(());
            }
            if self.status.is_some() {
                self.poll()?;
                if pattern.matches(&self.output) {
                    return Ok(());
                }
                if self.finished() {
                    return Err(TerminalCaptureError::new(
                        "terminal exited before the expected output arrived",
                        None,
                    ));
                }
                continue;
            }
            if deadline.is_some_and(|limit| Instant::now() >= limit) {
                return Err(TerminalCaptureError::new(
                    format!(
                        "terminal wait_for timed out after {} ms",
                        timeout.unwrap_or_default().as_millis()
                    ),
                    None,
                ));
            }
            self.poll()?;
        }
    }

    /// Send text, a named key, or a resize to the live terminal, using the same
    /// vocabulary as [`TerminalInteraction`].
    pub fn send(&mut self, interaction: &TerminalInteraction) -> Result<(), TerminalCaptureError> {
        if let Some(marker) = &interaction.after {
            let pattern = TerminalPattern::text(marker.clone());
            self.wait_for(&pattern, interaction.idle_duration, None)?;
        } else if let Some(expression) = &interaction.after_regex {
            let pattern = TerminalPattern::regex(expression)?;
            self.wait_for(&pattern, interaction.idle_duration, None)?;
        } else if interaction.idle_duration > Duration::ZERO {
            while self.idle_for() < interaction.idle_duration && self.status.is_none() {
                self.poll()?;
            }
        }
        if self.status.is_some() {
            return Err(TerminalCaptureError::new(
                "terminal session has already exited",
                None,
            ));
        }
        append_frame(&mut self.frames, &self.parser, self.started);
        apply_interaction(
            interaction,
            self.writer.as_mut(),
            self.master.as_ref(),
            &mut self.parser,
            &mut self.recording,
            self.started,
        )
    }

    /// Wait for a child that exits on its own, then produce the capture.
    pub fn finish(mut self) -> Result<TerminalCapture, TerminalCaptureError> {
        while !self.finished() {
            self.poll()?;
        }
        self.into_capture()
    }

    /// Stop the child if it is still running, then produce the capture and write
    /// any configured artifacts.
    pub fn close(mut self) -> Result<TerminalCapture, TerminalCaptureError> {
        if self.status.is_none() {
            self.stop()?;
        }
        while !self.finished() {
            self.read_available();
        }
        self.into_capture()
    }

    fn into_capture(mut self) -> Result<TerminalCapture, TerminalCaptureError> {
        let pending = std::mem::take(&mut self.pending_render);
        self.parser.process(&pending);
        append_frame(&mut self.frames, &self.parser, self.started);
        let capture = capture_result(
            self.status
                .clone()
                .expect("child status is available after the capture loop"),
            std::mem::take(&mut self.output),
            std::mem::take(&mut self.frames),
            self.interaction_index,
            std::mem::replace(&mut self.recording, asciicast(&self.options)),
        );
        if let Some(directory) = &self.options.artifact_directory {
            write_terminal_artifacts(
                directory,
                &capture.frames,
                &capture.transcript,
                &capture.asciicast,
            )?;
        }
        if self.timed_out {
            return Err(TerminalCaptureError::new(
                format!(
                    "terminal command timed out after {} ms",
                    self.options.timeout.unwrap_or_default().as_millis()
                ),
                Some(capture),
            ));
        }
        Ok(capture)
    }
}

/// Open a terminal session that stays alive until the caller closes it.
///
/// Unlike [`capture_terminal`], input may be sent at any later point through
/// [`TerminalSession::send`], and readiness can be awaited with
/// [`TerminalSession::wait_for`]. `options.timeout` defaults to `None` here, so
/// nothing terminates the child until [`TerminalSession::close`] is called.
pub fn open_terminal(
    options: TerminalCaptureOptions,
) -> Result<TerminalSession, TerminalCaptureError> {
    TerminalSession::open(TerminalCaptureOptions {
        timeout: None,
        ..options
    })
}

/// Run a command inside a real pseudoterminal and retain its settled TUI states.
pub fn capture_terminal(
    options: TerminalCaptureOptions,
) -> Result<TerminalCapture, TerminalCaptureError> {
    if options.file.is_empty() {
        return Err(TerminalCaptureError::new(
            "capture_terminal requires a file",
            None,
        ));
    }
    TerminalSession::open(options)?.finish()
}

pub async fn capture_terminal_async(
    options: TerminalCaptureOptions,
) -> Result<TerminalCapture, TerminalCaptureError> {
    tokio::task::spawn_blocking(move || capture_terminal(options))
        .await
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?
}
