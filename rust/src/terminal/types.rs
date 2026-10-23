use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalResize {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalKey {
    Backspace,
    CtrlC,
    CtrlD,
    Down,
    Enter,
    Escape,
    Left,
    Right,
    Tab,
    Up,
    Raw(String),
}

impl TerminalKey {
    pub(crate) fn sequence(&self) -> &str {
        match self {
            Self::Backspace => "\u{7f}",
            Self::CtrlC => "\u{3}",
            Self::CtrlD => "\u{4}",
            Self::Down => "\u{1b}[B",
            Self::Enter => "\r",
            Self::Escape => "\u{1b}",
            Self::Left => "\u{1b}[D",
            Self::Right => "\u{1b}[C",
            Self::Tab => "\t",
            Self::Up => "\u{1b}[A",
            Self::Raw(sequence) => sequence,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct TerminalInteraction {
    pub after: Option<String>,
    pub after_regex: Option<String>,
    pub idle_duration: Duration,
    pub text: Option<String>,
    pub key: Option<TerminalKey>,
    pub resize: Option<TerminalResize>,
}

/// One file written to [`TerminalCaptureOptions::artifact_directory`]
/// (issue #231). The names match the JS `artifacts` option.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TerminalArtifact {
    /// `transcript.txt`: the unrolled transcript.
    Transcript,
    /// `frames.json`: every retained frame.
    Frames,
    /// `session.cast`: the asciicast v2 recording.
    Cast,
    /// `snapshot.svg`: the final frame.
    Snapshot,
    /// `recording.svg`: every frame, animated.
    Recording,
    /// `recording.gif`: every frame, animated, as a GIF.
    Gif,
}

impl TerminalArtifact {
    /// Every artifact, in the order they are written.
    pub const ALL: [Self; 6] = [
        Self::Transcript,
        Self::Frames,
        Self::Cast,
        Self::Snapshot,
        Self::Recording,
        Self::Gif,
    ];

    /// The selection name, as used by the JS `artifacts` option.
    pub fn name(self) -> &'static str {
        match self {
            Self::Transcript => "transcript",
            Self::Frames => "frames",
            Self::Cast => "cast",
            Self::Snapshot => "snapshot",
            Self::Recording => "recording",
            Self::Gif => "gif",
        }
    }

    /// The file written inside the artifact directory.
    pub fn file_name(self) -> &'static str {
        match self {
            Self::Transcript => "transcript.txt",
            Self::Frames => "frames.json",
            Self::Cast => "session.cast",
            Self::Snapshot => "snapshot.svg",
            Self::Recording => "recording.svg",
            Self::Gif => "recording.gif",
        }
    }
}

impl FromStr for TerminalArtifact {
    type Err = TerminalCaptureError;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|artifact| artifact.name() == name)
            .ok_or_else(|| {
                let expected = Self::ALL.map(Self::name).join(", ");
                TerminalCaptureError::new(
                    format!("unknown terminal artifact {name:?}; expected one of {expected}"),
                    None,
                )
            })
    }
}

/// What happened during a capture, reported to
/// [`TerminalCaptureOptions::on_trace`]. The kinds match the JS `onTrace`
/// event `type`s (see [`TerminalTraceEvent::kind`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalTraceEvent {
    /// A scripted interaction became ready and is about to be applied.
    InteractionScheduled { interaction_index: usize },
    /// A scripted interaction is being written to the terminal.
    InteractionApplied { interaction_index: usize },
    /// The deadline passed; the child is being stopped.
    Timeout { timeout_milliseconds: u128 },
    /// The child wrote to the terminal.
    Output { data: String },
    /// The child exited and all of its output was read; always the last event.
    Exit {
        exit_code: i32,
        signal: Option<String>,
    },
}

impl TerminalTraceEvent {
    /// The JS `onTrace` event `type`.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::InteractionScheduled { .. } => "interaction-scheduled",
            Self::InteractionApplied { .. } => "interaction-applied",
            Self::Timeout { .. } => "timeout",
            Self::Output { .. } => "output",
            Self::Exit { .. } => "exit",
        }
    }
}

/// A trace event with the seconds elapsed since the capture started.
#[derive(Debug, Clone, PartialEq)]
pub struct TerminalTrace {
    pub time: f64,
    pub event: TerminalTraceEvent,
}

/// Callback for [`TerminalCaptureOptions::on_trace`]. It runs on the thread
/// driving the capture, so it should return quickly.
#[derive(Clone)]
pub struct TerminalTraceCallback(Arc<dyn Fn(&TerminalTrace) + Send + Sync>);

impl TerminalTraceCallback {
    pub fn new(callback: impl Fn(&TerminalTrace) + Send + Sync + 'static) -> Self {
        Self(Arc::new(callback))
    }

    pub(crate) fn call(&self, trace: &TerminalTrace) {
        (self.0)(trace);
    }
}

impl fmt::Debug for TerminalTraceCallback {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TerminalTraceCallback")
    }
}

#[derive(Debug, Clone)]
pub struct TerminalCaptureOptions {
    pub file: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// Variables set on top of the inherited environment.
    pub env: HashMap<String, String>,
    /// Inherited variables to drop, applied after `env` (issue #229).
    pub env_remove: Vec<String>,
    /// Start from an empty environment instead of the parent's (issue #229).
    /// `TERM`, `COLUMNS`, `LINES` and `env` are still set.
    pub env_clear: bool,
    pub cols: u16,
    /// Ignored when `aspect_ratio` is set.
    pub rows: u16,
    /// Derive `rows` as `max(1, round(cols / (2 * aspect_ratio)))`, like the JS
    /// `aspectRatio` option (JS defaults to `4 / 3`, i.e. 30 rows for 80
    /// columns; `None` keeps `rows`, 24 by default).
    pub aspect_ratio: Option<f64>,
    pub settle_duration: Duration,
    /// Retain a frame after every parsed PTY write instead of waiting for idle.
    pub frames_on_write: bool,
    /// Disable recording history; keep the latest frame and last 1MB of output.
    pub recording: bool,
    pub interactions: Vec<TerminalInteraction>,
    pub stop_marker: Option<String>,
    pub stop_marker_grace: Duration,
    /// Deadline for the whole run. `None` keeps the child alive indefinitely,
    /// which is the default for [`crate::terminal::open_terminal`] sessions.
    pub timeout: Option<Duration>,
    pub artifact_directory: Option<PathBuf>,
    /// Which files to write to `artifact_directory`; `None` writes all of
    /// [`TerminalArtifact::ALL`]. Renderers of unselected files are skipped.
    pub artifacts: Option<Vec<TerminalArtifact>>,
    /// Receives output, interaction, timeout and exit events as they happen.
    pub on_trace: Option<TerminalTraceCallback>,
}

impl Default for TerminalCaptureOptions {
    fn default() -> Self {
        Self {
            file: String::new(),
            args: Vec::new(),
            cwd: None,
            env: HashMap::new(),
            env_remove: Vec::new(),
            env_clear: false,
            cols: 80,
            rows: 24,
            aspect_ratio: None,
            settle_duration: Duration::from_millis(35),
            frames_on_write: false,
            recording: true,
            interactions: Vec::new(),
            stop_marker: None,
            stop_marker_grace: Duration::from_millis(250),
            timeout: Some(Duration::from_secs(30)),
            artifact_directory: None,
            artifacts: None,
            on_trace: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalCursor {
    pub x: u16,
    pub y: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TerminalFrame {
    pub time: f64,
    pub cols: u16,
    pub rows: u16,
    pub cursor: TerminalCursor,
    pub alternate: bool,
    pub lines: Vec<String>,
    pub screen: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AsciicastHeader {
    pub version: u8,
    pub width: u16,
    pub height: u16,
    pub timestamp: i64,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AsciicastEvent {
    pub time: f64,
    pub code: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Asciicast {
    pub header: AsciicastHeader,
    pub events: Vec<AsciicastEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TerminalCapture {
    pub exit_code: i32,
    pub signal: Option<String>,
    pub output: String,
    pub transcript: String,
    pub frames: Vec<TerminalFrame>,
    pub interaction_count: usize,
    pub asciicast: Asciicast,
}

#[derive(Debug)]
pub struct TerminalCaptureError {
    message: String,
    partial: Option<Box<TerminalCapture>>,
}

impl TerminalCaptureError {
    pub(crate) fn new(message: impl Into<String>, partial: Option<TerminalCapture>) -> Self {
        Self {
            message: message.into(),
            partial: partial.map(Box::new),
        }
    }

    pub fn partial_capture(&self) -> Option<&TerminalCapture> {
        self.partial.as_deref()
    }
}

impl fmt::Display for TerminalCaptureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TerminalCaptureError {}
