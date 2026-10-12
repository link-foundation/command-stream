//! Independent virtual terminal buffer with bounded frame notifications.
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

#[derive(Default)]
pub(crate) struct TerminalResponses {
    pending: Vec<u8>,
}

impl vt100::Callbacks for TerminalResponses {
    fn unhandled_csi(
        &mut self,
        screen: &mut vt100::Screen,
        intermediate: Option<u8>,
        _: Option<u8>,
        params: &[&[u16]],
        command: char,
    ) {
        let parameter = params
            .first()
            .and_then(|value| value.first())
            .copied()
            .unwrap_or(0);
        let response = match (intermediate, parameter, command) {
            (None, 5, 'n') => "\x1b[0n".to_owned(),
            (None, 6, 'n') => {
                let (row, col) = screen.cursor_position();
                format!("\x1b[{};{}R", row + 1, col + 1)
            }
            (None, 0, 'c') => "\x1b[?1;2c".to_owned(),
            (None, 18, 't') => {
                let (rows, cols) = screen.size();
                format!("\x1b[8;{rows};{cols}t")
            }
            _ => return,
        };
        self.pending.extend_from_slice(response.as_bytes());
    }
}

pub(crate) type TerminalParser = vt100::Parser<TerminalResponses>;

pub(crate) fn terminal_parser(rows: u16, cols: u16, scrollback: usize) -> TerminalParser {
    vt100::Parser::new_with_callbacks(rows, cols, scrollback, TerminalResponses::default())
}

pub(crate) fn take_terminal_input(parser: &mut TerminalParser) -> Vec<u8> {
    std::mem::take(&mut parser.callbacks_mut().pending)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BufferFrame {
    pub text: String,
    pub ansi: Vec<u8>,
    pub rows: u16,
    pub cols: u16,
    pub cursor: (u16, u16),
    pub alternate: bool,
}

/// A replayable ANSI update relative to the preceding sequence.
/// Resize the receiving terminal before applying an update with `reset` set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BufferChange {
    pub sequence: u64,
    pub rows: u16,
    pub cols: u16,
    pub cursor: (u16, u16),
    pub alternate: bool,
    pub reset: bool,
    pub ansi: Vec<u8>,
}

pub(crate) fn valid_dimensions(rows: u16, cols: u16) -> bool {
    rows > 0 && cols > 0 && u32::from(rows) * u32::from(cols) <= 1_000_000
}

pub(crate) struct BufferPublisher {
    previous: vt100::Screen,
    sequence: u64,
    pub frames: broadcast::Sender<BufferFrame>,
    pub changes: broadcast::Sender<BufferChange>,
}

impl BufferPublisher {
    pub fn new(screen: &vt100::Screen) -> Self {
        Self {
            previous: screen.clone(),
            sequence: 0,
            frames: broadcast::channel(16).0,
            changes: broadcast::channel(16).0,
        }
    }

    pub fn frame(screen: &vt100::Screen) -> BufferFrame {
        let (rows, cols) = screen.size();
        BufferFrame {
            text: screen.contents(),
            ansi: screen.state_formatted(),
            rows,
            cols,
            cursor: screen.cursor_position(),
            alternate: screen.alternate_screen(),
        }
    }

    pub fn publish(&mut self, screen: &vt100::Screen) {
        let frame = Self::frame(screen);
        if frame == Self::frame(&self.previous) {
            return;
        }
        let reset = screen.size() != self.previous.size()
            || screen.alternate_screen() != self.previous.alternate_screen();
        self.sequence += 1;
        let change = BufferChange {
            sequence: self.sequence,
            rows: frame.rows,
            cols: frame.cols,
            cursor: frame.cursor,
            alternate: frame.alternate,
            reset,
            ansi: if reset {
                let mut ansi = if frame.alternate {
                    b"\x1b[?1049h".to_vec()
                } else {
                    b"\x1b[?1049l".to_vec()
                };
                ansi.extend_from_slice(&frame.ansi);
                ansi
            } else {
                screen.state_diff(&self.previous)
            },
        };
        self.previous = screen.clone();
        let _ = self.frames.send(frame);
        let _ = self.changes.send(change);
    }
}

pub struct TerminalBuffer {
    parser: TerminalParser,
    publisher: BufferPublisher,
}

impl TerminalBuffer {
    pub fn new(rows: u16, cols: u16) -> Self {
        assert!(valid_dimensions(rows, cols));
        let parser = terminal_parser(rows, cols, 1000);
        let publisher = BufferPublisher::new(parser.screen());
        Self { parser, publisher }
    }
    pub fn snapshot(&self) -> BufferFrame {
        BufferPublisher::frame(self.parser.screen())
    }
    pub fn text(&self, color: bool) -> String {
        if color {
            String::from_utf8_lossy(&self.parser.screen().contents_formatted()).into_owned()
        } else {
            self.parser.screen().contents()
        }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<BufferFrame> {
        self.publisher.frames.subscribe()
    }
    /// Bounded changes only. A slow receiver gets `RecvError::Lagged`; take a
    /// new snapshot before applying subsequent deltas in that case.
    pub fn subscribe_changes(&self) -> broadcast::Receiver<BufferChange> {
        self.publisher.changes.subscribe()
    }
    pub fn write(&mut self, data: &[u8]) {
        self.parser.process(data);
        self.flush();
    }
    /// Query responses to forward to the application or remote PTY input.
    pub fn take_input(&mut self) -> Vec<u8> {
        take_terminal_input(&mut self.parser)
    }
    pub fn resize(&mut self, rows: u16, cols: u16) {
        assert!(valid_dimensions(rows, cols));
        self.parser.screen_mut().set_size(rows, cols);
        self.flush();
    }
    pub fn flush(&mut self) {
        self.publisher.publish(self.parser.screen());
    }
}
