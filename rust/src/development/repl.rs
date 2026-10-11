use super::child::ManagedChild;
use std::io;
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::process::Command;

static NEXT_SESSION: AtomicU64 = AtomicU64::new(0);

/// Real Rust evaluation via Evcxr, including persistent variables and async code.
#[derive(Debug, Clone)]
pub struct ReplOptions {
    /// Evcxr executable; defaults to COMMAND_STREAM_EVCXR or `evcxr` on PATH.
    pub executable: PathBuf,
    /// Local crate directory. None loads the version of the invoking library.
    pub crate_path: Option<PathBuf>,
    /// Disable terminal editing when driving the REPL through a pipe.
    pub disable_readline: bool,
}

impl Default for ReplOptions {
    fn default() -> Self {
        Self {
            executable: std::env::var_os("COMMAND_STREAM_EVCXR")
                .map(PathBuf::from)
                .unwrap_or_else(|| "evcxr".into()),
            crate_path: Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
                .filter(|path| path.join("Cargo.toml").is_file()),
            disable_readline: false,
        }
    }
}

struct SessionDirectory(PathBuf);
impl Drop for SessionDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Owns the evaluator and its isolated startup configuration.
pub struct RustRepl {
    process: ManagedChild,
    _session: SessionDirectory,
}

impl RustRepl {
    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        self.process.child.wait().await
    }
    pub async fn close(&mut self) -> io::Result<()> {
        self.process.stop().await
    }
}

/// Start an Evcxr session with the entire command-stream crate in scope.
///
/// Requires `rustup component add rust-src` and `cargo install --locked evcxr_repl`.
/// Evcxr supplies Rust parsing, diagnostics, multiline editing and completion.
/// Fully qualified macros such as `command_stream::s!` work without special parsing.
pub fn start_repl(options: ReplOptions) -> io::Result<RustRepl> {
    let path = std::env::temp_dir().join(format!(
        ".command-stream-repl-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir(&path)?;
    let session = SessionDirectory(path);
    let dependency = match options.crate_path {
        Some(path) => format!(
            "path = {}",
            serde_json::to_string(&path.canonicalize()?.to_string_lossy())?
        ),
        None => format!("version = {:?}", env!("CARGO_PKG_VERSION")),
    };
    let facade = session.0.join("facade");
    std::fs::create_dir(&facade)?;
    std::fs::write(facade.join("Cargo.toml"),
        format!("[package]\nname = \"command-stream-repl-context\"\nversion = \"0.0.0\"\nedition = \"2021\"\n[lib]\npath = \"lib.rs\"\ncrate-type = [\"dylib\"]\n[dependencies]\ncommand_stream = {{ package = \"command-stream\", {dependency} }}\ntokio = {{ version = \"1\", features = [\"full\"] }}\n"))?;
    std::fs::write(
        facade.join("lib.rs"),
        "pub use command_stream::*;\npub use tokio;\n",
    )?;
    std::fs::write(
        session.0.join("init.evcxr"),
        // The dylib facade shares Tokio process/signal state across cells.
        format!(":opt 0\n:dep command_stream = {{ package = \"command-stream-repl-context\", path = {} }}\n:dep tokio = {{ version = \"1\", features = [\"full\"] }}\n", serde_json::to_string(&facade.to_string_lossy())?),
    )?;
    std::fs::write(session.0.join("prelude.rs"), "use command_stream::*;\n")?;
    let mut command = Command::new(options.executable);
    command
        .env("EVCXR_CONFIG_DIR", &session.0)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    if options.disable_readline {
        command.arg("--disable-readline");
    }
    let process = ManagedChild::spawn(&mut command, !options.disable_readline).map_err(|error| {
        io::Error::new(error.kind(), format!("Cannot start Rust REPL: {error}. Install Rust sources with `rustup component add rust-src` and the evaluator with `cargo install --locked evcxr_repl`, or set COMMAND_STREAM_EVCXR."))
    })?;
    Ok(RustRepl {
        process,
        _session: session,
    })
}
