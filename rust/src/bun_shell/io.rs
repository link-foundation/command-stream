//! Shell IO primitives: buffers, the in-memory pipeline [`Channel`], the
//! serialized [`Writer`] (Bun's `IOWriter`), the [`Reader`] (Bun's
//! `IOReader`), the [`ShellSysError`] system error and the output/input kinds
//! (Bun's `OutKind` / `InKind`).
//!
//! Ported from Bun's `src/runtime/shell/IO.rs`, `IOWriter.rs` and
//! `IOReader.rs` (MIT, Copyright (c) Oven-sh / Jarred Sumner) by way of the
//! JavaScript port `js/src/bun-shell/io.mjs`, whose behaviour this module
//! reproduces.
//!
//! Output kinds ([`OutKind`]):
//! - `Fd { writer, captured }`: write through a [`Writer`]; `captured`
//!   receives a copy of every byte successfully written (the root
//!   stdout/stderr when not quiet).
//! - `Pipe`: append to the shell env's buffered stdout/stderr.
//! - `Ignore`: discard.
//!
//! Input kinds ([`InKind`]): `Fd(Reader)` or `Ignore`.

#![allow(dead_code)]

use std::collections::VecDeque;
use std::fmt;
use std::fs::File;
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::sync::Notify;

use super::errno::{code_of_raw_os_error, errno_message, errno_of};

/// Bun's `RedirectFlags` (the bits of `Cmd.redirect`).
pub(crate) mod redirect_flags {
    pub(crate) const STDIN: u8 = 1;
    pub(crate) const STDOUT: u8 = 2;
    pub(crate) const STDERR: u8 = 4;
    pub(crate) const APPEND: u8 = 8;
    pub(crate) const DUPLICATE_OUT: u8 = 16;
}

/// Bytes a [`Channel`] holds before writers have to wait.
pub(crate) const HIGH_WATER: usize = 64 * 1024;
/// Size of one read from a file or the process stdin.
pub(crate) const READ_CHUNK: usize = 64 * 1024;

/// stdout or stderr.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Which {
    Stdout,
    Stderr,
}

impl Which {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Which::Stdout => "stdout",
            Which::Stderr => "stderr",
        }
    }
}

/// Bun's `RedirectFlags::redirects_elsewhere`: whether the command's own
/// redirect sends `which` somewhere other than the shell's IO.
pub(crate) fn redirects_elsewhere(flags: u8, which: Which) -> bool {
    let bit = match which {
        Which::Stdout => redirect_flags::STDOUT,
        Which::Stderr => redirect_flags::STDERR,
    };
    if flags & redirect_flags::DUPLICATE_OUT != 0 {
        flags & bit == 0
    } else {
        flags & bit != 0
    }
}

/// A shared growable byte buffer (the JS `ByteList`; Bun's buffered
/// stdout/stderr `Vec<u8>`).
#[derive(Clone, Debug, Default)]
pub(crate) struct SharedBuf(Arc<Mutex<Vec<u8>>>);

impl SharedBuf {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, Vec<u8>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn append(&self, bytes: &[u8]) {
        if !bytes.is_empty() {
            self.lock().extend_from_slice(bytes);
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.lock().len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.lock().is_empty()
    }

    pub(crate) fn to_vec(&self) -> Vec<u8> {
        self.lock().clone()
    }

    /// The contents, leaving the buffer empty.
    pub(crate) fn take(&self) -> Vec<u8> {
        std::mem::take(&mut *self.lock())
    }

    pub(crate) fn clear(&self) {
        self.lock().clear();
    }

    pub(crate) fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    pub(crate) fn with<R>(&self, f: impl FnOnce(&mut Vec<u8>) -> R) -> R {
        f(&mut self.lock())
    }
}

/// A shell system error (Bun's `SystemError` as used by the shell).
///
/// `message()` is the coreutils-style text ("No such file or directory"),
/// `path` the offending path (may be empty), `errno` the positive errno
/// number (libuv's numbering on Windows, like Node's `os.constants.errno`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShellSysError {
    pub(crate) code: &'static str,
    pub(crate) errno: i32,
    pub(crate) path: String,
    pub(crate) syscall: &'static str,
}

impl ShellSysError {
    pub(crate) fn new(code: &'static str) -> Self {
        Self {
            code,
            errno: errno_of(code),
            path: String::new(),
            syscall: "",
        }
    }

    pub(crate) fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = path.into();
        self
    }

    pub(crate) fn with_syscall(mut self, syscall: &'static str) -> Self {
        self.syscall = syscall;
        self
    }

    pub(crate) fn epipe() -> Self {
        Self::new("EPIPE")
    }

    /// The coreutils-style message, or the code when it has none.
    pub(crate) fn message(&self) -> &'static str {
        errno_message(self.code).unwrap_or(self.code)
    }

    /// Bun's `ShellErr::Sys` display: `bun: {message}: {path}`.
    pub(crate) fn display(&self) -> String {
        format!("bun: {}: {}", self.message(), self.path)
    }

    /// Convert an `io::Error` (the JS `sysErrorFromNode`), keeping `path`.
    pub(crate) fn from_io(err: &io::Error, path: impl Into<String>) -> Self {
        let (code, errno) = match err.raw_os_error() {
            Some(raw) => {
                let code = code_of_raw_os_error(raw).unwrap_or("UNKNOWN");
                let errno = if cfg!(windows) {
                    match errno_of(code) {
                        0 => raw.abs(),
                        n => n,
                    }
                } else {
                    raw.abs()
                };
                (code, errno)
            }
            None => {
                let code = match err.kind() {
                    io::ErrorKind::NotFound => "ENOENT",
                    io::ErrorKind::PermissionDenied => "EACCES",
                    io::ErrorKind::AlreadyExists => "EEXIST",
                    io::ErrorKind::BrokenPipe => "EPIPE",
                    io::ErrorKind::WouldBlock => "EAGAIN",
                    io::ErrorKind::InvalidInput => "EINVAL",
                    io::ErrorKind::NotADirectory => "ENOTDIR",
                    io::ErrorKind::IsADirectory => "EISDIR",
                    io::ErrorKind::DirectoryNotEmpty => "ENOTEMPTY",
                    io::ErrorKind::StorageFull => "ENOSPC",
                    _ => "EIO",
                };
                (code, errno_of(code))
            }
        };
        Self {
            code,
            errno,
            path: path.into(),
            syscall: "",
        }
    }
}

impl fmt::Display for ShellSysError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ShellSysError {}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

#[derive(Default)]
struct ChannelState {
    chunks: VecDeque<Vec<u8>>,
    pending: usize,
    write_closed: bool,
    read_closed: bool,
    /// Bumped whenever a read brings `pending` back under the high-water
    /// mark; a blocked writer resumes once it changes.
    drain_gen: u64,
}

#[derive(Default)]
struct ChannelInner {
    state: Mutex<ChannelState>,
    readable: Notify,
    drained: Notify,
}

/// In-memory pipe between two pipeline items (Bun uses a socketpair). The
/// buffer is bounded: a writer waits while more than [`HIGH_WATER`] bytes are
/// pending. Closing the read end makes pending and later writes fail with
/// EPIPE, like writing to a pipe whose reader is gone.
#[derive(Clone, Default)]
pub(crate) struct Channel(Arc<ChannelInner>);

impl fmt::Debug for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let st = self.state();
        f.debug_struct("Channel")
            .field("pending", &st.pending)
            .field("write_closed", &st.write_closed)
            .field("read_closed", &st.read_closed)
            .finish()
    }
}

impl Channel {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn state(&self) -> MutexGuard<'_, ChannelState> {
        self.0.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Queue `bytes`; waits while the buffer is over the high-water mark.
    /// Fails with EPIPE once the read end is closed.
    pub(crate) async fn write(&self, bytes: Vec<u8>) -> Result<(), ShellSysError> {
        let gen = {
            let mut st = self.state();
            if st.read_closed {
                return Err(ShellSysError::epipe());
            }
            st.pending += bytes.len();
            st.chunks.push_back(bytes);
            self.0.readable.notify_waiters();
            if st.pending <= HIGH_WATER {
                return Ok(());
            }
            st.drain_gen
        };
        loop {
            let notified = self.0.drained.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let st = self.state();
                if st.drain_gen != gen {
                    return Ok(());
                }
                if st.read_closed {
                    return Err(ShellSysError::epipe());
                }
            }
            notified.await;
        }
    }

    /// Close the write end (EOF for the reader once the queue is drained).
    pub(crate) fn close(&self) {
        self.state().write_closed = true;
        self.0.readable.notify_waiters();
    }

    /// Close the read end: queued data is dropped and pending and future
    /// writes fail with EPIPE.
    pub(crate) fn close_read(&self) {
        {
            let mut st = self.state();
            if st.read_closed {
                return;
            }
            st.read_closed = true;
            st.chunks.clear();
            st.pending = 0;
        }
        self.0.drained.notify_waiters();
        self.0.readable.notify_waiters();
    }

    pub(crate) fn is_read_closed(&self) -> bool {
        self.state().read_closed
    }

    /// The next chunk, or `None` at EOF (or once the read end is closed).
    pub(crate) async fn read(&self) -> Option<Vec<u8>> {
        loop {
            let notified = self.0.readable.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut st = self.state();
                if let Some(chunk) = st.chunks.pop_front() {
                    st.pending -= chunk.len();
                    if st.pending <= HIGH_WATER {
                        st.drain_gen = st.drain_gen.wrapping_add(1);
                        self.0.drained.notify_waiters();
                    }
                    return Some(chunk);
                }
                if st.write_closed || st.read_closed {
                    return None;
                }
            }
            notified.await;
        }
    }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/// Where a [`Writer`] sends its bytes.
pub(crate) enum WriterTarget {
    /// A file opened by the shell (a redirect target); closed when the last
    /// reference to the writer is dropped.
    File(Arc<File>),
    /// The process stdout (the JS `StreamTarget(process.stdout)`).
    Stdout,
    /// The process stderr.
    Stderr,
    /// The write end of a pipeline [`Channel`]; closed (EOF) when the last
    /// reference to the writer is dropped or on [`Writer::close`].
    Channel(Channel),
}

struct WriterInner {
    target: WriterTarget,
    /// Serializes writes (tokio's mutex is FIFO) and holds the sticky error.
    err: tokio::sync::Mutex<Option<ShellSysError>>,
    closed: AtomicBool,
}

impl Drop for WriterInner {
    fn drop(&mut self) {
        if let WriterTarget::Channel(c) = &self.target {
            c.close();
        }
    }
}

/// Bun's `IOWriter`: writes are serialized in order and every chunk written
/// is also appended to the chunk's `captured` buffer. Errors are sticky: once
/// a write fails (EPIPE marks the writer as broken) every later write fails
/// with the same error without touching the target. Cloning shares the
/// writer (the JS `ref()`); dropping the last clone closes it (`deref()`).
#[derive(Clone)]
pub(crate) struct Writer(Arc<WriterInner>);

impl fmt::Debug for Writer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match &self.0.target {
            WriterTarget::File(_) => "file",
            WriterTarget::Stdout => "stdout",
            WriterTarget::Stderr => "stderr",
            WriterTarget::Channel(_) => "channel",
        };
        write!(f, "Writer({kind})")
    }
}

impl Writer {
    pub(crate) fn new(target: WriterTarget) -> Self {
        Self(Arc::new(WriterInner {
            target,
            err: tokio::sync::Mutex::new(None),
            closed: AtomicBool::new(false),
        }))
    }

    pub(crate) fn file(file: File) -> Self {
        Self::new(WriterTarget::File(Arc::new(file)))
    }

    pub(crate) fn stdout() -> Self {
        Self::new(WriterTarget::Stdout)
    }

    pub(crate) fn stderr() -> Self {
        Self::new(WriterTarget::Stderr)
    }

    pub(crate) fn channel(channel: Channel) -> Self {
        Self::new(WriterTarget::Channel(channel))
    }

    pub(crate) fn target(&self) -> &WriterTarget {
        &self.0.target
    }

    pub(crate) fn is_channel(&self) -> bool {
        matches!(self.0.target, WriterTarget::Channel(_))
    }

    pub(crate) fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    /// Write `data`, then append it to `captured`. Returns the (sticky)
    /// error of this or an earlier write.
    pub(crate) async fn write(
        &self,
        data: &[u8],
        captured: Option<&SharedBuf>,
    ) -> Result<(), ShellSysError> {
        let mut err = self.0.err.lock().await;
        if let Some(e) = &*err {
            return Err(e.clone());
        }
        if data.is_empty() {
            return Ok(());
        }
        let res = match &self.0.target {
            WriterTarget::File(f) => {
                let f = Arc::clone(f);
                let data = data.to_vec();
                run_blocking(move || write_all_retrying(&mut &*f, &data)).await
            }
            WriterTarget::Stdout => {
                let data = data.to_vec();
                run_blocking(move || {
                    let mut out = io::stdout().lock();
                    write_all_retrying(&mut out, &data)?;
                    out.flush()
                })
                .await
            }
            WriterTarget::Stderr => {
                let data = data.to_vec();
                run_blocking(move || {
                    let mut out = io::stderr().lock();
                    write_all_retrying(&mut out, &data)?;
                    out.flush()
                })
                .await
            }
            WriterTarget::Channel(c) => c
                .write(data.to_vec())
                .await
                .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe)),
        };
        match res {
            Ok(()) => {
                if let Some(c) = captured {
                    c.append(data);
                }
                Ok(())
            }
            Err(e) => {
                let e = ShellSysError::from_io(&e, "").with_syscall("write");
                *err = Some(e.clone());
                Err(e)
            }
        }
    }

    /// Close the target after pending writes (EOF for a channel). Files and
    /// the process streams are closed when the last clone is dropped.
    pub(crate) async fn close(&self) {
        let _guard = self.0.err.lock().await;
        if !self.0.closed.swap(true, Ordering::SeqCst) {
            if let WriterTarget::Channel(c) = &self.0.target {
                c.close();
            }
        }
    }

    /// An OS handle for a child process's stdio: a duplicate of the file or
    /// of the process stdout/stderr; `None` for a channel.
    pub(crate) fn try_clone_file(&self) -> Option<io::Result<File>> {
        match &self.0.target {
            WriterTarget::File(f) => Some(f.try_clone()),
            WriterTarget::Stdout => Some(dup_process_stdio(Which::Stdout)),
            WriterTarget::Stderr => Some(dup_process_stdio(Which::Stderr)),
            WriterTarget::Channel(_) => None,
        }
    }
}

/// `write_all` that waits out EAGAIN on non-blocking fds (a shared tty or
/// pipe), like the JS `FdTarget`.
fn write_all_retrying(w: &mut impl Write, mut data: &[u8]) -> io::Result<()> {
    while !data.is_empty() {
        match w.write(data) {
            Ok(0) => return Err(io::Error::from(io::ErrorKind::WriteZero)),
            Ok(n) => data = &data[n..],
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> io::Result<T> {
    match tokio::task::spawn_blocking(f).await {
        Ok(r) => r,
        Err(e) => Err(io::Error::other(e)),
    }
}

/// A duplicate of the process stdin/stdout/stderr handle as a `File`.
pub(crate) fn dup_process_stdio(which: Which) -> io::Result<File> {
    dup_std(Some(which))
}

fn dup_process_stdin() -> io::Result<File> {
    dup_std(None)
}

#[cfg(unix)]
fn dup_std(which: Option<Which>) -> io::Result<File> {
    use std::os::fd::AsFd;
    let owned = match which {
        None => io::stdin().as_fd().try_clone_to_owned()?,
        Some(Which::Stdout) => io::stdout().as_fd().try_clone_to_owned()?,
        Some(Which::Stderr) => io::stderr().as_fd().try_clone_to_owned()?,
    };
    Ok(File::from(owned))
}

#[cfg(windows)]
fn dup_std(which: Option<Which>) -> io::Result<File> {
    use std::os::windows::io::AsHandle;
    let owned = match which {
        None => io::stdin().as_handle().try_clone_to_owned()?,
        Some(Which::Stdout) => io::stdout().as_handle().try_clone_to_owned()?,
        Some(Which::Stderr) => io::stderr().as_handle().try_clone_to_owned()?,
    };
    Ok(File::from(owned))
}

#[cfg(not(any(unix, windows)))]
fn dup_std(_which: Option<Which>) -> io::Result<File> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/// Where a [`Reader`] reads from.
pub(crate) enum ReaderSource {
    /// The read end of a pipeline [`Channel`].
    Channel(Channel),
    /// A file opened by `< file`; closed when the last reference is dropped.
    File(Arc<File>),
    /// The process stdin.
    Stdin,
}

struct ReaderInner {
    source: ReaderSource,
    /// A lazily duplicated handle of the process stdin (read unbuffered, so
    /// nothing is lost for children that inherit it later).
    stdin: Mutex<Option<Arc<File>>>,
}

impl Drop for ReaderInner {
    fn drop(&mut self) {
        if let ReaderSource::Channel(c) = &self.source {
            c.close_read();
        }
    }
}

/// Bun's `IOReader`: the read side of an input. Cloning shares the reader;
/// dropping the last clone closes it (for a channel: EPIPE for its writer).
#[derive(Clone)]
pub(crate) struct Reader(Arc<ReaderInner>);

impl fmt::Debug for Reader {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match &self.0.source {
            ReaderSource::Channel(_) => "channel",
            ReaderSource::File(_) => "file",
            ReaderSource::Stdin => "stdin",
        };
        write!(f, "Reader({kind})")
    }
}

impl Reader {
    pub(crate) fn new(source: ReaderSource) -> Self {
        Self(Arc::new(ReaderInner {
            source,
            stdin: Mutex::new(None),
        }))
    }

    pub(crate) fn channel(channel: Channel) -> Self {
        Self::new(ReaderSource::Channel(channel))
    }

    pub(crate) fn file(file: File) -> Self {
        Self::new(ReaderSource::File(Arc::new(file)))
    }

    pub(crate) fn stdin() -> Self {
        Self::new(ReaderSource::Stdin)
    }

    pub(crate) fn source(&self) -> &ReaderSource {
        &self.0.source
    }

    pub(crate) fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    /// The next chunk, `Ok(None)` at EOF.
    pub(crate) async fn read_chunk(&self) -> Result<Option<Vec<u8>>, ShellSysError> {
        let file = match &self.0.source {
            ReaderSource::Channel(c) => return Ok(c.read().await),
            ReaderSource::File(f) => Arc::clone(f),
            ReaderSource::Stdin => self.stdin_file()?,
        };
        let detached = matches!(self.0.source, ReaderSource::Stdin);
        loop {
            match read_once(Arc::clone(&file), detached).await {
                Ok(buf) if buf.is_empty() => return Ok(None),
                Ok(buf) => return Ok(Some(buf)),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                // Windows reports EOF of a pipe as a broken pipe.
                Err(e) if e.kind() == io::ErrorKind::BrokenPipe => return Ok(None),
                Err(e) => return Err(ShellSysError::from_io(&e, "").with_syscall("read")),
            }
        }
    }

    /// Read everything until EOF.
    pub(crate) async fn read_to_end(&self) -> Result<Vec<u8>, ShellSysError> {
        let mut out = Vec::new();
        while let Some(chunk) = self.read_chunk().await? {
            out.extend_from_slice(&chunk);
        }
        Ok(out)
    }

    /// Stop reading (a consumer that exits early closes its end of the pipe).
    pub(crate) fn close(&self) {
        if let ReaderSource::Channel(c) = &self.0.source {
            c.close_read();
        }
    }

    /// An OS handle for a child process's stdin: a duplicate of the file;
    /// `None` for a channel or the process stdin.
    pub(crate) fn try_clone_file(&self) -> Option<io::Result<File>> {
        match &self.0.source {
            ReaderSource::File(f) => Some(f.try_clone()),
            _ => None,
        }
    }

    fn stdin_file(&self) -> Result<Arc<File>, ShellSysError> {
        let mut guard = self.0.stdin.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(f) = &*guard {
            return Ok(Arc::clone(f));
        }
        let f = Arc::new(
            dup_process_stdin().map_err(|e| ShellSysError::from_io(&e, "").with_syscall("read"))?,
        );
        *guard = Some(Arc::clone(&f));
        Ok(f)
    }
}

/// One blocking read of up to [`READ_CHUNK`] bytes. Reads of the process
/// stdin run on a detached thread so a read that never completes cannot
/// keep the tokio runtime from shutting down.
async fn read_once(file: Arc<File>, detached: bool) -> io::Result<Vec<u8>> {
    let read = move || {
        let mut buf = vec![0u8; READ_CHUNK];
        let n = (&*file).read(&mut buf)?;
        buf.truncate(n);
        Ok(buf)
    };
    if !detached {
        return run_blocking(read).await;
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("bun-shell-stdin".into())
        .spawn(move || {
            let _ = tx.send(read());
        })?;
    rx.await
        .unwrap_or_else(|_| Err(io::Error::from(io::ErrorKind::BrokenPipe)))
}

// ---------------------------------------------------------------------------
// IO kinds
// ---------------------------------------------------------------------------

/// Bun's `OutKind`.
#[derive(Clone, Debug)]
pub(crate) enum OutKind {
    /// Write through `writer`; `captured` receives a copy of what was written.
    Fd {
        writer: Writer,
        captured: Option<SharedBuf>,
    },
    /// Append to the shell env's buffered stdout/stderr.
    Pipe,
    /// Discard.
    Ignore,
}

impl OutKind {
    /// The JS `fdOut(writer, captured)`.
    pub(crate) fn fd(writer: Writer, captured: Option<SharedBuf>) -> Self {
        OutKind::Fd { writer, captured }
    }

    /// Write `data` (the interpreter's error-writing path): through the
    /// writer for `Fd`, appended to `buffered` for `Pipe`.
    pub(crate) async fn write(
        &self,
        data: &[u8],
        buffered: &SharedBuf,
    ) -> Result<(), ShellSysError> {
        match self {
            OutKind::Fd { writer, captured } => writer.write(data, captured.as_ref()).await,
            OutKind::Pipe => {
                buffered.append(data);
                Ok(())
            }
            OutKind::Ignore => Ok(()),
        }
    }
}

/// Bun's `InKind`.
#[derive(Clone, Debug)]
pub(crate) enum InKind {
    Fd(Reader),
    Ignore,
}

/// A command's stdin/stdout/stderr (Bun's `IO`).
#[derive(Clone, Debug)]
pub(crate) struct ShellIO {
    pub(crate) stdin: InKind,
    pub(crate) stdout: OutKind,
    pub(crate) stderr: OutKind,
}

impl ShellIO {
    pub(crate) fn out(&self, which: Which) -> &OutKind {
        match which {
            Which::Stdout => &self.stdout,
            Which::Stderr => &self.stderr,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn channel_backpressure_and_eof() {
        let ch = Channel::new();
        // Under the high-water mark the write completes immediately.
        ch.write(vec![b'a'; HIGH_WATER]).await.unwrap();
        // Over it, the writer waits until the reader drains.
        let w = {
            let ch = ch.clone();
            tokio::spawn(async move { ch.write(vec![b'b'; 10]).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!w.is_finished());
        assert_eq!(ch.read().await.unwrap().len(), HIGH_WATER);
        w.await.unwrap().unwrap();
        assert_eq!(ch.read().await.unwrap(), b"b".repeat(10));
        ch.close();
        assert_eq!(ch.read().await, None);
    }

    #[tokio::test]
    async fn channel_close_read_is_epipe() {
        let ch = Channel::new();
        ch.write(vec![0; HIGH_WATER]).await.unwrap();
        let w = {
            let ch = ch.clone();
            tokio::spawn(async move { ch.write(vec![1; 1]).await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        ch.close_read();
        let err = w.await.unwrap().unwrap_err();
        assert_eq!(err.code, "EPIPE");
        assert_eq!(err.message(), "Broken pipe");
        assert_eq!(ch.write(vec![2]).await.unwrap_err().code, "EPIPE");
        assert_eq!(ch.read().await, None);
    }

    #[tokio::test]
    async fn writer_capture_sticky_error_and_close() {
        let ch = Channel::new();
        let reader = Reader::channel(ch.clone());
        let writer = Writer::channel(ch);
        let cap = SharedBuf::new();
        writer.write(b"hi", Some(&cap)).await.unwrap();
        assert_eq!(cap.to_vec(), b"hi");
        assert_eq!(reader.read_chunk().await.unwrap().unwrap(), b"hi");
        // Dropping the last writer clone closes the channel: EOF.
        let w2 = writer.clone();
        drop(writer);
        w2.write(b"x", None).await.unwrap();
        drop(w2);
        assert_eq!(reader.read_chunk().await.unwrap().unwrap(), b"x");
        assert_eq!(reader.read_chunk().await.unwrap(), None);

        // Dropping the reader breaks the pipe; the error sticks.
        let ch = Channel::new();
        let reader = Reader::channel(ch.clone());
        let writer = Writer::channel(ch);
        drop(reader);
        let e = writer.write(b"a", Some(&cap)).await.unwrap_err();
        assert_eq!((e.code, e.syscall), ("EPIPE", "write"));
        assert_eq!(writer.write(b"b", None).await.unwrap_err().code, "EPIPE");
        assert_eq!(cap.to_vec(), b"hi");
    }

    #[tokio::test]
    async fn writer_and_reader_files() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f");
        let w = Writer::file(File::create(&p).unwrap());
        w.write(b"one ", None).await.unwrap();
        w.write(b"two", None).await.unwrap();
        drop(w);
        let r = Reader::file(File::open(&p).unwrap());
        assert_eq!(r.read_to_end().await.unwrap(), b"one two");
    }

    #[test]
    fn sys_error_from_io() {
        // 2 is ENOENT on unix and ERROR_FILE_NOT_FOUND on Windows.
        let e = ShellSysError::from_io(&io::Error::from_raw_os_error(2), "x");
        assert_eq!(e.code, "ENOENT");
        assert_eq!(e.message(), "No such file or directory");
        assert_eq!(e.display(), "bun: No such file or directory: x");
        let e = ShellSysError::from_io(&io::Error::other("boom"), "");
        assert_eq!(e.code, "EIO");
        assert!(redirects_elsewhere(redirect_flags::STDOUT, Which::Stdout));
        assert!(!redirects_elsewhere(redirect_flags::STDOUT, Which::Stderr));
        let dup = redirect_flags::DUPLICATE_OUT | redirect_flags::STDOUT;
        assert!(!redirects_elsewhere(dup, Which::Stdout));
        assert!(redirects_elsewhere(dup, Which::Stderr));
    }
}
