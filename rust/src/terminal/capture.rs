use super::artifacts::{unroll_terminal_frames, write_terminal_artifacts};
use super::types::{
    Asciicast, AsciicastEvent, AsciicastHeader, TerminalCapture, TerminalCaptureError,
    TerminalCaptureOptions, TerminalCursor, TerminalFrame, TerminalInteraction, TerminalResize,
};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
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

pub fn capture_terminal(
    options: TerminalCaptureOptions,
) -> Result<TerminalCapture, TerminalCaptureError> {
    if options.file.is_empty() {
        return Err(TerminalCaptureError::new(
            "capture_terminal requires a file",
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
    let mut child = pty
        .slave
        .spawn_command(command)
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
    drop(pty.slave);
    let reader = pty
        .master
        .try_clone_reader()
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
    let mut writer = pty
        .master
        .take_writer()
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
    let receiver = spawn_reader(reader);
    let started = Instant::now();
    let mut parser = vt100::Parser::new(options.rows, options.cols, 100_000);
    let mut recording = asciicast(&options);
    let mut output = String::new();
    let mut frames = Vec::new();
    let mut pending_render = Vec::new();
    let mut terminal_has_output = false;
    let mut interaction_index = 0;
    let mut last_output = None;
    let mut dirty = false;
    let mut reader_closed = false;
    let mut status = None;
    let mut timed_out = false;
    let mut stop_deadline = None;

    loop {
        match receiver.recv_timeout(Duration::from_millis(5)) {
            Ok(data) => {
                let text = String::from_utf8_lossy(&data);
                output.push_str(&text);
                record(&mut recording, started, "o", text.into_owned());
                pending_render.extend_from_slice(&data);
                let render_data = drain_complete_render_data(&mut pending_render);
                let segments = render_segments(&render_data);
                let segment_count = segments.len();
                if terminal_has_output && render_data.starts_with(ERASE_SCREEN) {
                    append_frame(&mut frames, &parser, started);
                }
                for (index, segment) in segments.into_iter().enumerate() {
                    parser.process(segment);
                    terminal_has_output |= !segment.is_empty();
                    if index + 1 < segment_count {
                        append_frame(&mut frames, &parser, started);
                    }
                }
                last_output = Some(Instant::now());
                dirty = true;
                if options
                    .stop_marker
                    .as_ref()
                    .is_some_and(|marker| output.contains(marker))
                    && stop_deadline.is_none()
                {
                    append_frame(&mut frames, &parser, started);
                    stop_deadline = Some(Instant::now() + options.stop_marker_grace);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => reader_closed = true,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        while let Some(interaction) = options.interactions.get(interaction_index) {
            if interaction
                .after
                .as_ref()
                .is_some_and(|marker| !output.contains(marker))
            {
                break;
            }
            if interaction_regexes[interaction_index]
                .as_ref()
                .is_some_and(|pattern| !pattern.is_match(&output))
            {
                break;
            }
            if interaction.idle_duration > Duration::ZERO
                && last_output.map_or_else(|| started.elapsed(), |instant| instant.elapsed())
                    < interaction.idle_duration
            {
                break;
            }
            append_frame(&mut frames, &parser, started);
            apply_interaction(
                interaction,
                writer.as_mut(),
                pty.master.as_ref(),
                &mut parser,
                &mut recording,
                started,
            )?;
            interaction_index += 1;
        }

        if dirty && last_output.is_some_and(|instant| instant.elapsed() >= options.settle_duration)
        {
            append_frame(&mut frames, &parser, started);
            dirty = false;
        }
        if status.is_none() {
            status = child
                .try_wait()
                .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
        }
        if status.is_some() && reader_closed {
            break;
        }
        if status.is_none()
            && (started.elapsed() >= options.timeout
                || stop_deadline.is_some_and(|deadline| Instant::now() >= deadline))
        {
            timed_out = started.elapsed() >= options.timeout;
            let _ = child.kill();
            status = Some(
                child
                    .wait()
                    .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?,
            );
        }
    }

    parser.process(&pending_render);
    append_frame(&mut frames, &parser, started);
    let capture = capture_result(
        status.expect("child status is available after capture loop"),
        output,
        frames,
        interaction_index,
        recording,
    );
    if let Some(directory) = &options.artifact_directory {
        write_terminal_artifacts(
            directory,
            &capture.frames,
            &capture.transcript,
            &capture.asciicast,
        )?;
    }
    if timed_out {
        return Err(TerminalCaptureError::new(
            format!(
                "terminal command timed out after {} ms",
                options.timeout.as_millis()
            ),
            Some(capture),
        ));
    }
    Ok(capture)
}

pub async fn capture_terminal_async(
    options: TerminalCaptureOptions,
) -> Result<TerminalCapture, TerminalCaptureError> {
    tokio::task::spawn_blocking(move || capture_terminal(options))
        .await
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?
}
