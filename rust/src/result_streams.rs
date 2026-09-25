//! Re-readable snapshots of completed command output and a writable stdin record.

use serde::{Serialize, Serializer};
use std::fmt;
use std::io::{self, Read, Write};
use std::ops::Deref;
use std::path::Path;

/// Captured text that also implements `Read`. Reading advances a byte cursor;
/// string methods keep working on the complete, unconsumed snapshot.
#[derive(Debug, Clone, Default)]
pub struct CapturedOutput {
    text: String,
    position: usize,
}

impl CapturedOutput {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            position: 0,
        }
    }

    pub fn rewind(&mut self) {
        self.position = 0;
    }
}

impl From<String> for CapturedOutput {
    fn from(text: String) -> Self {
        Self::new(text)
    }
}

impl From<&str> for CapturedOutput {
    fn from(text: &str) -> Self {
        Self::new(text)
    }
}

impl Deref for CapturedOutput {
    type Target = String;
    fn deref(&self) -> &String {
        &self.text
    }
}

impl AsRef<Path> for CapturedOutput {
    fn as_ref(&self) -> &Path {
        Path::new(&self.text)
    }
}

impl AsRef<str> for CapturedOutput {
    fn as_ref(&self) -> &str {
        &self.text
    }
}

impl AsRef<[u8]> for CapturedOutput {
    fn as_ref(&self) -> &[u8] {
        self.text.as_bytes()
    }
}

impl Read for CapturedOutput {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let bytes = self.text.as_bytes();
        let remaining = &bytes[self.position..];
        let size = buf.len().min(remaining.len());
        buf[..size].copy_from_slice(&remaining[..size]);
        self.position += size;
        Ok(size)
    }
}

impl fmt::Display for CapturedOutput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.text.fmt(f)
    }
}

impl Serialize for CapturedOutput {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.text)
    }
}

impl PartialEq<str> for CapturedOutput {
    fn eq(&self, other: &str) -> bool {
        self.text == other
    }
}

impl PartialEq<&str> for CapturedOutput {
    fn eq(&self, other: &&str) -> bool {
        self.text == *other
    }
}

impl PartialEq<String> for CapturedOutput {
    fn eq(&self, other: &String) -> bool {
        &self.text == other
    }
}

impl PartialEq for CapturedOutput {
    fn eq(&self, other: &Self) -> bool {
        self.text == other.text
    }
}

impl Eq for CapturedOutput {}

/// Writable record of input sent to a completed command. Writes after completion
/// change this record only; use `ProcessRunner::write_stdin` for live input.
#[derive(Debug, Clone, Default)]
pub struct CapturedInput(Vec<u8>);

impl CapturedInput {
    pub fn new(bytes: impl Into<Vec<u8>>) -> Self {
        Self(bytes.into())
    }
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl Write for CapturedInput {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl fmt::Display for CapturedInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        String::from_utf8_lossy(&self.0).fmt(f)
    }
}
