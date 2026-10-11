//! Independent virtual terminal buffer with bounded frame notifications.
use tokio::sync::broadcast;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BufferFrame {
    pub text: String,
    pub ansi: Vec<u8>,
    pub rows: u16,
    pub cols: u16,
    pub cursor: (u16, u16),
    pub alternate: bool,
}

pub struct TerminalBuffer {
    parser: vt100::Parser,
    previous: BufferFrame,
    frames: broadcast::Sender<BufferFrame>,
}

impl TerminalBuffer {
    pub fn new(rows: u16, cols: u16) -> Self {
        assert!(rows > 0 && cols > 0 && u32::from(rows) * u32::from(cols) <= 1_000_000);
        let parser = vt100::Parser::new(rows, cols, 1000);
        let previous = Self::frame(&parser);
        let (frames, _) = broadcast::channel(16);
        Self {
            parser,
            previous,
            frames,
        }
    }
    fn frame(parser: &vt100::Parser) -> BufferFrame {
        let screen = parser.screen();
        let (rows, cols) = screen.size();
        BufferFrame {
            text: screen.contents(),
            ansi: screen.contents_formatted(),
            rows,
            cols,
            cursor: screen.cursor_position(),
            alternate: screen.alternate_screen(),
        }
    }
    pub fn snapshot(&self) -> BufferFrame {
        Self::frame(&self.parser)
    }
    pub fn text(&self, color: bool) -> String {
        if color {
            String::from_utf8_lossy(&self.parser.screen().contents_formatted()).into_owned()
        } else {
            self.parser.screen().contents()
        }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<BufferFrame> {
        self.frames.subscribe()
    }
    pub fn write(&mut self, data: &[u8]) {
        self.parser.process(data);
        self.flush();
    }
    pub fn resize(&mut self, rows: u16, cols: u16) {
        assert!(rows > 0 && cols > 0 && u32::from(rows) * u32::from(cols) <= 1_000_000);
        self.parser.screen_mut().set_size(rows, cols);
        self.flush();
    }
    pub fn flush(&mut self) {
        let frame = self.snapshot();
        if frame != self.previous {
            self.previous = frame.clone();
            let _ = self.frames.send(frame);
        }
    }
}
