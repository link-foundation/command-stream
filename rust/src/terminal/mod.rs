mod artifacts;
mod capture;
mod types;

pub use artifacts::{read_asciicast, serialize_asciicast, unroll_terminal_frames};
pub use capture::{capture_terminal, capture_terminal_async};
pub use types::{
    Asciicast, AsciicastEvent, AsciicastHeader, TerminalCapture, TerminalCaptureError,
    TerminalCaptureOptions, TerminalCursor, TerminalFrame, TerminalInteraction, TerminalKey,
    TerminalResize,
};
