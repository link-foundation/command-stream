use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::watch;

/// Portable counterparts of Execa process options.
#[derive(Debug, Clone)]
pub struct Options {
    pub cwd: Option<PathBuf>,
    pub env: HashMap<String, String>,
    pub extend_env: bool,
    pub input: Option<Vec<u8>>,
    pub reject: bool,
    pub strip_final_newline: bool,
    pub all: bool,
    pub buffer: bool,
    pub max_buffer: usize,
    pub timeout: Option<Duration>,
    pub cancel_signal: Option<CancelSignal>,
    pub kill_signal: String,
    pub prefer_local: crate::PreferLocal,
    pub node_exec_path: OsString,
    pub node_options: Vec<OsString>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            cwd: None,
            env: HashMap::new(),
            extend_env: true,
            input: None,
            reject: true,
            strip_final_newline: true,
            all: false,
            buffer: true,
            max_buffer: 100_000_000,
            timeout: None,
            cancel_signal: None,
            kill_signal: "SIGTERM".into(),
            prefer_local: crate::PreferLocal::Off,
            node_exec_path: "node".into(),
            node_options: Vec::new(),
        }
    }
}

/// A clonable cancellation controller. Dropping it does not cancel the child.
#[derive(Debug, Clone)]
pub struct Cancellation(watch::Sender<bool>);

impl Default for Cancellation {
    fn default() -> Self {
        Self::new()
    }
}

impl Cancellation {
    pub fn new() -> Self {
        Self(watch::channel(false).0)
    }

    pub fn signal(&self) -> CancelSignal {
        CancelSignal(self.0.subscribe())
    }

    pub fn cancel(&self) {
        self.0.send_replace(true);
    }
}

/// Cancellation state supplied to a command.
#[derive(Debug, Clone)]
pub struct CancelSignal(pub(crate) watch::Receiver<bool>);
