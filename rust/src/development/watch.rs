use super::child::ManagedChild;
use crate::trace::trace_lazy;
use glob::{MatchOptions, Pattern};
use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime};
use tokio::process::Command;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

/// Watch glob patterns and restart Cargo, or another exact-argv command.
#[derive(Debug, Clone)]
pub struct DevOptions {
    pub cwd: PathBuf,
    pub watch: Vec<String>,
    /// Exact argv. Defaults to `cargo run`; use `--manifest-path` for another crate.
    pub command: Vec<String>,
    pub initial: bool,
    pub interval: Duration,
    pub debounce: Duration,
}

impl Default for DevOptions {
    fn default() -> Self {
        Self {
            cwd: std::env::current_dir().unwrap_or_else(|_| ".".into()),
            watch: vec![
                "**/*.rs".into(),
                "**/Cargo.toml".into(),
                "**/Cargo.lock".into(),
            ],
            command: vec!["cargo".into(), "run".into()],
            initial: true,
            interval: Duration::from_millis(100),
            debounce: Duration::from_millis(50),
        }
    }
}

#[derive(Debug, Clone)]
pub enum DevEvent {
    Restarted {
        /// Absolute paths under the canonical watch root; empty for the initial run.
        files: Vec<PathBuf>,
        pid: Option<u32>,
    },
    Error(String),
}

/// Explicit shutdown waits for the current child and stops its descendants.
/// Dropping the controller also requests shutdown.
pub struct DevController {
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<io::Result<()>>>,
    events: mpsc::Receiver<DevEvent>,
}

impl DevController {
    pub async fn next_event(&mut self) -> Option<DevEvent> {
        self.events.recv().await
    }
    pub async fn close(mut self) -> io::Result<()> {
        let _ = self.stop.send(true);
        self.task.take().unwrap().await.map_err(io::Error::other)?
    }
}
impl Drop for DevController {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

type Snapshot = BTreeMap<PathBuf, (SystemTime, u64)>;
fn snapshot(root: &Path, patterns: &[Pattern]) -> io::Result<Snapshot> {
    let mut files = BTreeMap::new();
    let mut directories = vec![root.to_owned()];
    let options = MatchOptions {
        require_literal_separator: true,
        ..MatchOptions::new()
    };
    while let Some(dir) = directories.pop() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name();
            if ["target", ".git", "node_modules"]
                .iter()
                .any(|ignored| name == *ignored)
                || name.to_string_lossy().starts_with(".command-stream-")
            {
                continue;
            }
            let path = entry.path();
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                directories.push(path);
            } else if file_type.is_file()
                && patterns.iter().any(|pattern| {
                    pattern.matches_path_with(path.strip_prefix(root).unwrap(), options)
                })
            {
                match entry.metadata() {
                    Ok(info) => {
                        files.insert(path, (info.modified()?, info.len()));
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
            }
        }
    }
    Ok(files)
}

fn spawn(options: &DevOptions) -> io::Result<ManagedChild> {
    let mut command = Command::new(&options.command[0]);
    command
        .args(&options.command[1..])
        .current_dir(&options.cwd)
        .env("COMMAND_STREAM_DEV_CHILD", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    ManagedChild::spawn(&mut command, false)
}

/// Start watching after validating the root, patterns and executable.
/// Creation, deletion and edits all trigger restarts; build output is excluded.
pub async fn dev(mut options: DevOptions) -> io::Result<DevController> {
    if options.interval < Duration::from_millis(10) || options.command.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid watch interval or empty command",
        ));
    }
    options.cwd = options.cwd.canonicalize()?;
    let patterns = options
        .watch
        .iter()
        .map(|pattern| Pattern::new(pattern.trim_start_matches("./")))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    let previous = snapshot(&options.cwd, &patterns)?;
    let (stop, receiver) = watch::channel(false);
    let (tx, events) = mpsc::channel(32);
    let child_mode = std::env::var_os("COMMAND_STREAM_DEV_CHILD").is_some();
    let child = if options.initial && !child_mode {
        Some(spawn(&options)?)
    } else {
        None
    };
    if let Some(child) = &child {
        let _ = tx.try_send(DevEvent::Restarted {
            files: vec![],
            pid: child.child.id(),
        });
    }
    let task = tokio::spawn(async move {
        if child_mode {
            return Ok(());
        }
        watch_loop(options, patterns, previous, child, receiver, tx).await
    });
    Ok(DevController {
        stop,
        task: Some(task),
        events,
    })
}

async fn watch_loop(
    options: DevOptions,
    patterns: Vec<Pattern>,
    mut previous: Snapshot,
    mut child: Option<ManagedChild>,
    mut stop: watch::Receiver<bool>,
    events: mpsc::Sender<DevEvent>,
) -> io::Result<()> {
    let mut tick = tokio::time::interval(options.interval);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut changes = BTreeSet::new();
    let mut changed_at = Instant::now();
    loop {
        tokio::select! {
            _ = stop.changed() => break,
            _ = tick.tick() => {
                let next = match snapshot(&options.cwd, &patterns) {
                    Ok(next) => next,
                    Err(error) => { let _ = events.try_send(DevEvent::Error(error.to_string())); continue; }
                };
                for file in previous.keys().chain(next.keys()) {
                    if previous.get(file) != next.get(file) {
                        changes.insert(file.clone());
                        changed_at = Instant::now();
                    }
                }
                previous = next;
                if !changes.is_empty() && changed_at.elapsed() >= options.debounce {
                    if let Some(mut current) = child.take() { current.stop().await?; }
                    if *stop.borrow() { break; }
                    let files = std::mem::take(&mut changes).into_iter().collect::<Vec<_>>();
                    trace_lazy("Development", || format!("Restarting after changes: {files:?}"));
                    match spawn(&options) {
                        Ok(next) => {
                            let _ = events.try_send(DevEvent::Restarted { files, pid: next.child.id() });
                            child = Some(next);
                        }
                        Err(error) => { let _ = events.try_send(DevEvent::Error(error.to_string())); }
                    }
                }
            }
        }
    }
    if let Some(mut child) = child {
        child.stop().await?;
    }
    Ok(())
}
