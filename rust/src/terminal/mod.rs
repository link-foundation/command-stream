mod artifacts;
mod buffer;
mod capture;
mod raster;
mod types;

pub use artifacts::{read_asciicast, serialize_asciicast, unroll_terminal_frames};
pub use buffer::{BufferChange, BufferFrame, TerminalBuffer};
pub use capture::{
    capture_terminal, capture_terminal_async, open_terminal, TerminalPattern, TerminalSession,
};
pub use types::{
    Asciicast, AsciicastEvent, AsciicastHeader, TerminalArtifact, TerminalCapture,
    TerminalCaptureError, TerminalCaptureOptions, TerminalCursor, TerminalFrame,
    TerminalInteraction, TerminalKey, TerminalResize, TerminalTrace, TerminalTraceCallback,
    TerminalTraceEvent,
};
