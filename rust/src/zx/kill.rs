//! Process-tree termination (zx `kill(pid, signal)`).

use super::error::ZxError;

/// Default signal for kills and timeouts.
pub const SIGTERM: &str = "SIGTERM";

/// Validate a pid given as text: it must consist of ASCII digits only.
pub fn validate_pid(pid: &str) -> Result<u32, ZxError> {
    if pid.is_empty() || !pid.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ZxError::new(format!("Invalid pid: {pid}")));
    }
    pid.parse::<u32>()
        .map_err(|_| ZxError::new(format!("Invalid pid: {pid}")))
}

/// Normalise a signal given as `SIGTERM`, `TERM` or a number.
#[cfg(unix)]
pub fn parse_signal(signal: &str) -> Result<nix::sys::signal::Signal, ZxError> {
    use nix::sys::signal::Signal;
    use std::str::FromStr;
    let unknown = || ZxError::new(format!("Unknown signal: {signal}"));
    if let Ok(num) = signal.parse::<i32>() {
        return Signal::try_from(num).map_err(|_| unknown());
    }
    let upper = signal.to_ascii_uppercase();
    let name = if upper.starts_with("SIG") {
        upper
    } else {
        format!("SIG{upper}")
    };
    Signal::from_str(&name).map_err(|_| unknown())
}

/// Name (`SIGTERM`, ...) of a numeric signal, if it is known.
#[cfg(unix)]
pub fn signal_name(num: i32) -> Option<String> {
    nix::sys::signal::Signal::try_from(num)
        .ok()
        .map(|s| s.as_str().to_string())
}

/// Name of a numeric signal (not available on this platform).
#[cfg(not(unix))]
pub fn signal_name(_num: i32) -> Option<String> {
    None
}

/// Pids of all descendants of `pid` (children first, depth-first), using `ps`.
#[cfg(unix)]
pub fn descendants(pid: u32) -> Vec<u32> {
    let listing = std::process::Command::new("ps")
        .args(["-A", "-o", "pid=", "-o", "ppid="])
        .stderr(std::process::Stdio::null())
        .output();
    let Ok(listing) = listing else {
        return Vec::new();
    };
    let table: Vec<(u32, u32)> = String::from_utf8_lossy(&listing.stdout)
        .lines()
        .filter_map(|line| {
            let mut cols = line.split_whitespace();
            let child = cols.next()?.parse().ok()?;
            let parent = cols.next()?.parse().ok()?;
            Some((child, parent))
        })
        .collect();
    let mut found = Vec::new();
    let mut queue = vec![pid];
    while let Some(parent) = queue.pop() {
        for &(child, ppid) in &table {
            if ppid == parent && child != pid && !found.contains(&child) {
                found.push(child);
                queue.push(child);
            }
        }
    }
    found
}

/// Pids of all descendants of `pid` (not supported on this platform).
#[cfg(not(unix))]
pub fn descendants(_pid: u32) -> Vec<u32> {
    Vec::new()
}

/// Send `signal` to `pid`, all of its descendants and its process group.
#[cfg(unix)]
pub fn kill_tree(pid: u32, signal: &str) -> Result<(), ZxError> {
    use nix::sys::signal::kill as send;
    use nix::unistd::Pid;
    let sig = parse_signal(signal)?;
    let raw = i32::try_from(pid).map_err(|_| ZxError::new(format!("Invalid pid: {pid}")))?;
    let children = descendants(pid);
    // Signal the process before its descendants (zx does the reverse). A shell
    // that forked its command and sees that child die first can still report the
    // death as exit code 128+n before its own signal lands, instead of dying by
    // the signal.
    if send(Pid::from_raw(-raw), sig).is_err() {
        let _ = send(Pid::from_raw(raw), sig);
    }
    for child in children {
        if let Ok(child) = i32::try_from(child) {
            let _ = send(Pid::from_raw(child), sig);
        }
    }
    Ok(())
}

/// Terminate `pid` and its descendants with `taskkill /t /f`.
#[cfg(not(unix))]
pub fn kill_tree(pid: u32, _signal: &str) -> Result<(), ZxError> {
    let status = std::process::Command::new("taskkill")
        .args(["/pid", &pid.to_string(), "/t", "/f"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(ZxError::new(format!("taskkill failed for pid {pid}")))
    }
}

/// Kill a process and all of its descendants (zx `kill()`).
///
/// `pid` must render as a string of digits; `signal` defaults to the current
/// scope's `kill_signal` (`SIGTERM`).
pub async fn kill(pid: impl ToString, signal: Option<&str>) -> Result<(), ZxError> {
    let pid = validate_pid(&pid.to_string())?;
    let signal = match signal {
        Some(s) => s.to_string(),
        None => super::shell::current_options().kill_signal,
    };
    tokio::task::spawn_blocking(move || kill_tree(pid, &signal))
        .await
        .map_err(|e| ZxError::new(e.to_string()))?
}
