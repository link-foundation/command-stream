//! zx "goods": small helpers for scripts (`sleep`, `retry`, `spinner`, ...).

use std::future::Future;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::error::ZxError;
use super::log::{log, LogEntry};
use super::shell::{configure, current_options, within};
use super::util::random_id;

/// Pause for `duration` (zx `sleep`).
pub async fn sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}

/// Pause for a zx duration string such as `"100ms"` or `"1s"`.
pub async fn sleep_for(duration: &str) -> Result<(), ZxError> {
    let duration = super::util::parse_duration(duration)?;
    tokio::time::sleep(duration).await;
    Ok(())
}

/// Call `f` until it succeeds, at most `count` times, without delays.
///
/// Returns the last error when every attempt fails. `count` is clamped to at
/// least one attempt.
pub async fn retry<T, E, F, Fut>(count: usize, f: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    retry_with_backoff(count, std::iter::repeat(Duration::ZERO), f).await
}

/// Like [`retry`], sleeping `delay` between attempts.
pub async fn retry_with_delay<T, E, F, Fut>(count: usize, delay: Duration, f: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    retry_with_backoff(count, std::iter::repeat(delay), f).await
}

/// Like [`retry`], taking the delay after each failure from `delays` (for
/// example [`exp_backoff`]). An exhausted iterator means no delay.
pub async fn retry_with_backoff<T, E, F, Fut, I>(count: usize, delays: I, mut f: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    I: IntoIterator<Item = Duration>,
{
    let total = count.max(1);
    let mut delays = delays.into_iter();
    let mut attempt = 0;
    loop {
        attempt += 1;
        let err = match f().await {
            Ok(value) => return Ok(value),
            Err(err) => err,
        };
        if attempt >= total {
            return Err(err);
        }
        let delay = delays.next().unwrap_or(Duration::ZERO);
        let opts = current_options();
        let entry = LogEntry::Retry {
            attempt,
            total: Some(total),
            delay,
        };
        log(&entry, opts.verbose && !opts.quiet);
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }
}

/// Exponential backoff delays: `min(delay * 2^n, max)` for n = 0, 1, 2, ...
pub fn exp_backoff(max: Duration, delay: Duration) -> impl Iterator<Item = Duration> {
    (0u32..).map(move |n| {
        let factor = 2u32.checked_pow(n.min(31)).unwrap_or(u32::MAX);
        delay.checked_mul(factor).map_or(max, |d| d.min(max))
    })
}

/// [`exp_backoff`] with zx's defaults (`max = 60s`, `delay = 100ms`).
pub fn exp_backoff_default() -> impl Iterator<Item = Duration> {
    exp_backoff(Duration::from_secs(60), Duration::from_millis(100))
}

/// Frames drawn by [`spinner`].
pub const SPINNER_FRAMES: [char; 10] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/// Whether [`spinner`] would draw anything: stderr must be a terminal, `CI`
/// unset and the current scope not quiet.
pub fn spinner_enabled() -> bool {
    !current_options().quiet && std::env::var_os("CI").is_none() && std::io::stderr().is_terminal()
}

/// Run `fut` while showing a spinner titled `title` on stderr (zx
/// `spinner`). Verbose logging is disabled for the duration of `fut`.
pub async fn spinner<F: Future>(title: &str, fut: F) -> F::Output {
    if !spinner_enabled() {
        return fut.await;
    }
    let title = title.to_string();
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    let ticker = tokio::spawn(async move {
        let mut frame = 0usize;
        let mut interval = tokio::time::interval(Duration::from_millis(100));
        interval.tick().await;
        loop {
            tokio::select! {
                _ = &mut stop_rx => break,
                _ = interval.tick() => {
                    let mut err = std::io::stderr();
                    let _ = write!(err, "  {} {title}\r", SPINNER_FRAMES[frame % 10]);
                    let _ = err.flush();
                    frame += 1;
                }
            }
        }
        let width = title.chars().count() + 4;
        let mut err = std::io::stderr();
        let _ = write!(err, "{}\r", " ".repeat(width));
        let _ = err.flush();
    });
    let output = within(async {
        configure(|o| o.verbose = false);
        fut.await
    })
    .await;
    let _ = stop_tx.send(());
    let _ = ticker.await;
    output
}

/// Print the arguments joined by spaces followed by a newline (zx `echo`).
pub fn echo<I, S>(parts: I)
where
    I: IntoIterator<Item = S>,
    S: std::fmt::Display,
{
    println!("{}", echo_line(parts));
}

/// The line [`echo`] would print (without the trailing newline).
pub fn echo_line<I, S>(parts: I) -> String
where
    I: IntoIterator<Item = S>,
    S: std::fmt::Display,
{
    parts
        .into_iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Create (like `mkdir -p`) and return a directory in the system temp dir.
/// `prefix` defaults to `zx-<random id>`.
pub fn tempdir(prefix: Option<&str>) -> Result<PathBuf, ZxError> {
    let name = prefix.map_or_else(|| format!("zx-{}", random_id()), str::to_string);
    let dir = std::env::temp_dir().join(name);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Create a temp file and return its path (zx `tempfile`).
///
/// With a `name` the file is placed in a fresh [`tempdir`]; otherwise it is
/// `zx-<random id>` in the system temp dir. The file is written with `data`
/// or created empty.
pub fn tempfile(name: Option<&str>, data: Option<&[u8]>) -> Result<PathBuf, ZxError> {
    let path = match name {
        Some(name) => tempdir(None)?.join(name),
        None => std::env::temp_dir().join(format!("zx-{}", random_id())),
    };
    std::fs::write(&path, data.unwrap_or_default())?;
    Ok(path)
}

/// Locate an executable on `PATH` (zx `which`).
pub fn which(name: &str) -> Option<PathBuf> {
    ::which::which(name).ok()
}

/// Expand a glob pattern into sorted paths (zx `glob`, subset: `*`, `?`,
/// `[...]` and `**`). Unreadable entries are skipped.
pub fn glob(pattern: &str) -> Result<Vec<PathBuf>, ZxError> {
    let entries = ::glob::glob(pattern).map_err(|e| ZxError::new(e.to_string()))?;
    let mut paths: Vec<PathBuf> = entries.filter_map(Result::ok).collect();
    paths.sort();
    Ok(paths)
}

/// Expand a glob pattern relative to `cwd`, returning paths relative to it.
pub fn glob_in(cwd: impl AsRef<Path>, pattern: &str) -> Result<Vec<PathBuf>, ZxError> {
    let cwd = cwd.as_ref();
    let full = cwd.join(pattern);
    let found = glob(&full.to_string_lossy())?;
    Ok(found
        .into_iter()
        .map(|p| p.strip_prefix(cwd).map(Path::to_path_buf).unwrap_or(p))
        .collect())
}
