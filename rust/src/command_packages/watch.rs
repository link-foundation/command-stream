//! In-process manifest watching; successful reloads replace commands atomically.
use super::CommandEnvironment;
use std::io;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, watch, RwLock};
use tokio::task::JoinHandle;

pub struct PackageWatcher {
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<()>>,
    events: mpsc::Receiver<Result<String, String>>,
}

impl PackageWatcher {
    pub async fn next_event(&mut self) -> Option<Result<String, String>> {
        self.events.recv().await
    }

    pub async fn close(mut self) -> io::Result<()> {
        let _ = self.stop.send(true);
        self.task.take().unwrap().await.map_err(io::Error::other)
    }
}

impl Drop for PackageWatcher {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

/// Install a manifest and start watching its canonical path before returning.
/// Atomic editor saves are recommended. Invalid edits retain the last working
/// package and produce an error event. Close waits for outstanding reload work.
pub async fn watch_package(
    environment: Arc<RwLock<CommandEnvironment>>,
    path: impl AsRef<Path>,
    interval: Duration,
) -> io::Result<PackageWatcher> {
    if interval < Duration::from_millis(10) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Watch interval must be at least 10ms",
        ));
    }
    let path = tokio::fs::canonicalize(path).await?;
    let mut previous = tokio::fs::read(&path).await?;
    environment
        .write()
        .await
        .install_file(&path)
        .await
        .map_err(io::Error::other)?;
    let (stop, mut receiver) = watch::channel(false);
    let (tx, events) = mpsc::channel(32);
    let task = tokio::spawn(async move {
        let mut tick = tokio::time::interval(interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = receiver.changed() => break,
                _ = tick.tick() => {
                    match tokio::fs::read(&path).await {
                        Ok(next) if next != previous => {
                            previous = next;
                            let result = environment.write().await.reload_file(&path).await;
                            let _ = tx.try_send(result);
                        }
                        Ok(_) => {},
                        Err(error) => { let _ = tx.try_send(Err(error.to_string())); },
                    }
                }
            }
        }
    });
    Ok(PackageWatcher {
        stop,
        task: Some(task),
        events,
    })
}
