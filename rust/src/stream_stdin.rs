//! Live stdin for [`crate::StreamingRunner`] (issue #230).
//!
//! [`crate::StreamingRunner::stdin_pipe`] keeps the child's stdin open for the
//! lifetime of the stream. Writes travel to a task that owns the pipe, so the
//! consumer can answer a prompt read from stdout while the output readers keep
//! running - a full-duplex child never deadlocks on a fixed stdin buffer.

use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

/// A request from [`crate::OutputStream`] to the task that owns stdin.
pub(crate) enum StdinRequest {
    /// Write and flush these bytes.
    Write(Vec<u8>, oneshot::Sender<std::io::Result<()>>),
    /// Shut stdin down so the child reads end-of-file.
    Close(oneshot::Sender<std::io::Result<()>>),
}

/// Sending half of the stdin pipe, held by the stream.
pub(crate) type StdinSender = mpsc::Sender<StdinRequest>;

/// Receiving half of the stdin pipe, consumed by the process task.
pub(crate) type StdinReceiver = mpsc::Receiver<StdinRequest>;

/// Create the request channel for a live stdin pipe.
pub(crate) fn channel() -> (StdinSender, StdinReceiver) {
    mpsc::channel(64)
}

/// Write `initial` (the one-shot `stdin` content, if any), then serve live
/// requests until the stream closes stdin, is dropped, or the child exits.
pub(crate) fn serve(
    mut stdin: ChildStdin,
    initial: Option<Vec<u8>>,
    mut requests: StdinReceiver,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        if let Some(content) = initial {
            if stdin.write_all(&content).await.is_err() {
                return;
            }
        }
        while let Some(request) = requests.recv().await {
            match request {
                StdinRequest::Write(data, ack) => {
                    let written = match stdin.write_all(&data).await {
                        Ok(()) => stdin.flush().await,
                        Err(error) => Err(error),
                    };
                    let _ = ack.send(written);
                }
                StdinRequest::Close(ack) => {
                    let _ = ack.send(stdin.shutdown().await);
                    return;
                }
            }
        }
        // Every sender is gone: the stream was dropped without closing stdin.
        let _ = stdin.shutdown().await;
    })
}

fn closed() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::BrokenPipe,
        "stdin is not open: call StreamingRunner::stdin_pipe(), and write before close_stdin() and before the process exits",
    )
}

/// Send one request and wait for the stdin task to carry it out.
pub(crate) async fn request(
    sender: Option<&StdinSender>,
    make: impl FnOnce(oneshot::Sender<std::io::Result<()>>) -> StdinRequest,
) -> std::io::Result<()> {
    let sender = sender.ok_or_else(closed)?;
    let (ack, done) = oneshot::channel();
    sender.send(make(ack)).await.map_err(|_| closed())?;
    done.await.map_err(|_| closed())?
}
