//! Rust port of `conformance/bun-shell/runner.mjs`: runs every corpus case
//! against `command_stream::bun_shell` and prints a PASS/FAIL/SKIP line per
//! case plus a summary.
//!
//! Environment variables:
//! - `BUN_SHELL_FILTER`: only cases whose id contains this substring.
//! - `BUN_SHELL_FILE`: only cases from this case file (`commands-echo` or
//!   `commands-echo.json`).
//! - `BUN_SHELL_CONCURRENCY`: cases run in parallel (default 8).
//! - `BUN_SHELL_NODE`: the node binary for `{{NODE}}` (default: `node` on PATH).
//! - `BUN_SHELL_VERBOSE=1`: print timing and details for passing cases too.

use crate::corpus::{
    all_cases, cases_dir, check_expectations, make_context, materialize, materialize_template,
    node_platform, setup_files, skip_reason, truthy, uses_node, Case, RunResult, SEP,
};
use command_stream::bun_shell::{shell, ShellCommand, ShellError, ShellValue};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

const DEFAULT_TIMEOUT_MS: u64 = 10_000;

/// Runner options (the command line options of runner.mjs).
#[derive(Clone, Debug)]
pub struct Options {
    pub filter: Option<String>,
    pub file: Option<String>,
    pub concurrency: usize,
    pub verbose: bool,
    pub node: Option<String>,
}

impl Options {
    pub fn from_env() -> Self {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        Self {
            filter: var("BUN_SHELL_FILTER"),
            file: var("BUN_SHELL_FILE"),
            concurrency: var("BUN_SHELL_CONCURRENCY")
                .and_then(|v| v.parse().ok())
                .unwrap_or(8),
            verbose: var("BUN_SHELL_VERBOSE").is_some_and(|v| v != "0"),
            node: var("BUN_SHELL_NODE").or_else(|| {
                which::which("node")
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned())
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub pass: usize,
    pub fail: usize,
    pub skip: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Status {
    Pass,
    Fail,
    Skip,
}

struct Outcome {
    status: Status,
    details: Vec<String>,
    ms: u128,
}

impl Outcome {
    fn from_details(details: Vec<String>) -> Self {
        let status = if details.is_empty() {
            Status::Pass
        } else {
            Status::Fail
        };
        Self {
            status,
            details,
            ms: 0,
        }
    }

    fn fail(detail: String) -> Self {
        Self::from_details(vec![detail])
    }
}

/// Shared, read-only state for all case runs.
struct Shared {
    base_tmp: PathBuf,
    node: Option<String>,
}

/// Run the (filtered) corpus and print the report. Returns the counts.
pub async fn run_corpus(opts: Options) -> Counts {
    let everything = all_cases(&cases_dir()).expect("cannot load the conformance corpus");

    // Sanity: ids must be unique across the corpus.
    let mut seen = HashSet::new();
    for c in &everything {
        assert!(
            seen.insert(c.id().to_string()),
            "duplicate case id: {}",
            c.id()
        );
    }

    let strip_json = |s: &str| s.strip_suffix(".json").unwrap_or(s).to_string();
    let cases: Vec<Arc<Case>> = everything
        .into_iter()
        .filter(|c| {
            opts.file
                .as_deref()
                .is_none_or(|f| strip_json(&c.file) == strip_json(f))
        })
        .filter(|c| opts.filter.as_deref().is_none_or(|f| c.id().contains(f)))
        .map(Arc::new)
        .collect();

    let shared = Arc::new(Shared {
        base_tmp: real_path(&std::env::temp_dir()),
        node: opts.node.clone(),
    });
    let platform = node_platform();
    let mut which_cache: HashMap<String, bool> = HashMap::new();
    let mut on_path = |bin: &str| {
        *which_cache
            .entry(bin.to_string())
            .or_insert_with(|| which::which(bin).is_ok())
    };

    let started = Instant::now();
    let semaphore = Arc::new(Semaphore::new(opts.concurrency.max(1)));
    let mut outcomes: Vec<Option<Outcome>> = Vec::with_capacity(cases.len());
    let mut handles = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let skip = skip_reason(&case.data, platform, "rust", &mut on_path).or_else(|| {
            (shared.node.is_none() && uses_node(&case.data)).then(|| {
                "requires node for {{NODE}}, but no node binary was found on PATH \
                 (set BUN_SHELL_NODE)"
                    .to_string()
            })
        });
        if let Some(reason) = skip {
            outcomes.push(Some(Outcome {
                status: Status::Skip,
                details: vec![reason],
                ms: 0,
            }));
            continue;
        }
        outcomes.push(None);
        let (case, shared, semaphore) = (case.clone(), shared.clone(), semaphore.clone());
        handles.push((
            i,
            tokio::spawn(async move {
                let _permit = semaphore.acquire_owned().await;
                let t0 = Instant::now();
                let mut outcome = run_one(&case, &shared).await;
                outcome.ms = t0.elapsed().as_millis();
                outcome
            }),
        ));
    }
    for (i, handle) in handles {
        outcomes[i] = Some(match handle.await {
            Ok(outcome) => outcome,
            Err(e) => Outcome::fail(format!("runner panicked: {}", panic_message(e))),
        });
    }

    let mut counts = Counts::default();
    for (case, outcome) in cases.iter().zip(outcomes) {
        let r = outcome.expect("every case has an outcome");
        let label = match r.status {
            Status::Pass => {
                counts.pass += 1;
                "PASS"
            }
            Status::Fail => {
                counts.fail += 1;
                "FAIL"
            }
            Status::Skip => {
                counts.skip += 1;
                "SKIP"
            }
        };
        if r.status == Status::Pass && !opts.verbose {
            println!("PASS {}", case.id());
            continue;
        }
        println!(
            "{label} {}  ({}:{}, {}ms)",
            case.id(),
            case.source,
            case.unit_line,
            r.ms
        );
        for d in &r.details {
            println!("     - {d}");
        }
    }
    println!();
    println!(
        "command-stream bun_shell (Rust) on {platform}; node for {{{{NODE}}}}: {}",
        shared.node.as_deref().unwrap_or("(not found)")
    );
    println!(
        "Total {}: {} passed, {} failed, {} skipped in {:.1}s",
        cases.len(),
        counts.pass,
        counts.fail,
        counts.skip,
        started.elapsed().as_secs_f64()
    );
    counts
}

fn panic_message(e: tokio::task::JoinError) -> String {
    if !e.is_panic() {
        return e.to_string();
    }
    let payload = e.into_panic();
    payload
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "(non-string panic payload)".to_string())
}

async fn run_one(case: &Case, shared: &Shared) -> Outcome {
    let temp = match TempDir::new(&shared.base_tmp) {
        Ok(t) => t,
        Err(e) => return Outcome::fail(format!("runner error: cannot create temp dir: {e}")),
    };
    let node = shared.node.as_deref().unwrap_or("node");
    match execute(case, temp.path(), node).await {
        Ok(details) => Outcome::from_details(details),
        Err(e) => Outcome::fail(format!("runner error: {e}")),
    }
}

/// Build a command like runner.mjs' `build()`:
/// `$(strings, ...values).cwd(cwd).env(env).quiet()` plus `.nothrow()`.
fn build(
    strings: &[String],
    values: Vec<ShellValue>,
    cwd: &Path,
    env: &HashMap<String, String>,
    nothrow: bool,
) -> Result<ShellCommand, ShellError> {
    let strings: Vec<&str> = strings.iter().map(String::as_str).collect();
    let cmd = shell(&strings, values)?
        .cwd(cwd.to_path_buf())
        .env(env.clone())
        .quiet();
    Ok(if nothrow { cmd.nothrow() } else { cmd })
}

/// Set up, run and check one case. `Err` is a runner error (bad case data,
/// failed setup); `Ok` holds the mismatches (empty = pass).
async fn execute(case: &Case, temp_dir: &Path, node: &str) -> Result<Vec<String>, String> {
    let c = &case.data;
    let ctx = make_context(&temp_dir.to_string_lossy(), node, SEP);
    setup_files(c, temp_dir, &ctx)?;
    let m = materialize(c, temp_dir, &ctx)?;
    let mut env: HashMap<String, String> = if truthy(c.get("envReplace")) {
        HashMap::new()
    } else {
        std::env::vars_os()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.to_string_lossy().into_owned(),
                )
            })
            .collect()
    };
    env.extend(m.env.iter().cloned());

    // Setup steps: nothrow mode, results ignored; anything else that goes
    // wrong (a parse or system error) is a runner error, as in runner.mjs.
    for (n, step) in c
        .get("setup")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        let t = materialize_template(step, &ctx, &mut HashMap::new())?;
        let run = async { build(&t.strings, t.values, &m.cwd, &env, true)?.run().await };
        run.await
            .map_err(|e| format!("setup step {}: {:?}: {}", n + 1, e.kind, e.message))?;
    }

    let mut result = RunResult {
        temp_dir: temp_dir.to_path_buf(),
        node: node.to_string(),
        sep: SEP.to_string(),
        ..RunResult::default()
    };
    let throws = truthy(c.get("throws"));
    let timeout_ms = c
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_TIMEOUT_MS);
    let exec = async {
        build(&m.strings, m.values, &m.cwd, &env, !throws)?
            .run()
            .await
    };
    match tokio::time::timeout(Duration::from_millis(timeout_ms), exec).await {
        Err(_) => return Ok(vec![format!("timed out after {timeout_ms}ms")]),
        Ok(Ok(out)) => {
            result.stdout = Some(out.stdout);
            result.stderr = Some(out.stderr);
            result.exit_code = Some(out.exit_code);
        }
        Ok(Err(e)) => {
            result.error = Some(e.message);
            if let Some(out) = e.output {
                result.stdout = Some(out.stdout);
                result.stderr = Some(out.stderr);
                result.exit_code = Some(out.exit_code);
            }
        }
    }
    result.buffers = m
        .buffers
        .iter()
        .map(|(id, b)| (id.clone(), b.contents()))
        .collect();
    Ok(check_expectations(c, &result))
}

/// `fs.realpathSync` without Windows' `\\?\` verbatim prefix (Node never
/// returns it, and it would leak into `{{TEMP}}`).
fn real_path(p: &Path) -> PathBuf {
    let Ok(real) = fs::canonicalize(p) else {
        return p.to_path_buf();
    };
    let s = real.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        real
    }
}

/// A fresh `bunshell-conf-*` directory, removed (best effort) on drop, also
/// when the case panics.
struct TempDir(PathBuf);

impl TempDir {
    fn new(base: &Path) -> std::io::Result<Self> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        loop {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = base.join(format!(
                "bunshell-conf-{}-{n}-{nanos:x}",
                std::process::id()
            ));
            match fs::create_dir(&dir) {
                Ok(()) => return Ok(Self(real_path(&dir))),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // Cases chmod things to 000 (and may leave read-only files behind on
        // Windows), so restore access before deleting.
        make_removable(&self.0);
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn make_removable(p: &Path) {
    let Ok(meta) = fs::symlink_metadata(p) else {
        return;
    };
    if meta.file_type().is_symlink() {
        return;
    }
    restore_permissions(p, &meta);
    if meta.is_dir() {
        if let Ok(entries) = fs::read_dir(p) {
            for entry in entries.flatten() {
                make_removable(&entry.path());
            }
        }
    }
}

#[cfg(unix)]
fn restore_permissions(p: &Path, meta: &fs::Metadata) {
    use std::os::unix::fs::PermissionsExt;
    let mode = meta.permissions().mode();
    let want = if meta.is_dir() {
        mode | 0o700
    } else {
        mode | 0o600
    };
    if want != mode {
        let _ = fs::set_permissions(p, fs::Permissions::from_mode(want));
    }
}

#[cfg(not(unix))]
#[allow(clippy::permissions_set_readonly_false)]
fn restore_permissions(p: &Path, meta: &fs::Metadata) {
    let mut perms = meta.permissions();
    if perms.readonly() {
        perms.set_readonly(false);
        let _ = fs::set_permissions(p, perms);
    }
}
