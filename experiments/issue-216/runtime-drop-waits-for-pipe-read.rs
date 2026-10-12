#!/usr/bin/env rust-script
//! Why a Windows `child_access` probe outlived the `run()` it was timing
//! (issue #216). Tokio reads Windows child pipes on blocking-pool threads, and
//! dropping a runtime waits for blocking work without limit. A descendant that
//! survives the kill keeps the pipe open, so the drop waits for it.
//!
//! Linux reads child pipes without the blocking pool, so this reproduces the
//! Windows arrangement directly: a `spawn_blocking` read of a pipe that a
//! surviving grandchild (`sleep 3` in the background) holds open.
//!
//! ```cargo
//! [dependencies]
//! tokio = { version = "1", features = ["full"] }
//! ```
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn probe(shutdown: &str) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let started = Instant::now();
    runtime.block_on(async {
        // The shell exits at once; its background `sleep` inherits stdout.
        let mut child = Command::new("sh")
            .args(["-c", "sleep 3 &"])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdout = child.stdout.take().unwrap();
        child.wait().unwrap();
        let read = tokio::task::spawn_blocking(move || {
            let mut buffer = Vec::new();
            stdout.read_to_end(&mut buffer)
        });
        // Like the bounded drain: give up on the read, keep going.
        let _ = tokio::time::timeout(Duration::from_millis(100), read).await;
    });
    let returned = started.elapsed();
    match shutdown {
        "drop" => drop(runtime),
        _ => runtime.shutdown_timeout(Duration::from_millis(100)),
    }
    println!(
        "{shutdown:>16}: body returned after {:.2}s, runtime gone after {:.2}s",
        returned.as_secs_f64(),
        started.elapsed().as_secs_f64()
    );
}

fn main() {
    probe("drop");
    probe("shutdown_timeout");
}
