use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
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

#[derive(Debug, Clone)]
pub struct TerminalCaptureOptions {
    pub file: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    pub settle_duration: Duration,
    pub interactions: Vec<TerminalInteraction>,
    pub stop_marker: Option<String>,
    pub stop_marker_grace: Duration,
    pub timeout: Duration,
    pub artifact_directory: Option<PathBuf>,
}

impl Default for TerminalCaptureOptions {
    fn default() -> Self {
        Self {
            file: String::new(),
            args: Vec::new(),
            cwd: None,
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            settle_duration: Duration::from_millis(35),
            interactions: Vec::new(),
            stop_marker: None,
            stop_marker_grace: Duration::from_millis(250),
            timeout: Duration::from_secs(30),
            artifact_directory: None,
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
