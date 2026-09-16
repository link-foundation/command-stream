//! Does the Rust side let a child handle the signal it was sent?
//!
//! Mirror of experiments/issue-15/js-kill-grace.mjs. The child traps SIGTERM
//! and appends to a marker file; an empty marker means the handler never ran.
//!
//! Run with: cargo test --test rust_kill_grace -- --nocapture
use command_stream::{OutputChunk, ProcessRunner, RunOptions, StreamingRunner};
use std::time::Duration;

fn child_script(marker: &std::path::Path) -> String {
    format!(
        "trap 'echo handled >> {marker}; exit 0' TERM INT; echo ready; while true; do sleep 0.05; done",
        marker = marker.display()
    )
}

async fn probe_stream(signal: &str) -> (i32, String) {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("marker");
    let runner = StreamingRunner::new(child_script(&marker)).kill_signal(signal);
    let mut stream = runner.stream();
    let mut code = -1;
    let mut killed = false;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(_) if !killed => {
                killed = true;
                stream.kill();
            }
            OutputChunk::Exit(c) => code = c,
            _ => {}
        }
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    let handled = std::fs::read_to_string(&marker).unwrap_or_default();
    (code, if handled.trim().is_empty() { "(handler never ran)".into() } else { handled.trim().into() })
}

#[tokio::test]
async fn stream_kill_grace() {
    for signal in ["SIGTERM", "SIGINT"] {
        let (code, handled) = probe_stream(signal).await;
        println!("STREAM signal={signal} code={code} handled={handled}");
    }
}

#[tokio::test]
async fn process_runner_kill_grace() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("marker");
    let mut runner = ProcessRunner::new(
        child_script(&marker),
        RunOptions { mirror: false, ..Default::default() },
    );
    runner.start().await.unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;
    runner.kill().unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;
    let handled = std::fs::read_to_string(&marker).unwrap_or_default();
    println!(
        "PROCESS_RUNNER kill() handled={}",
        if handled.trim().is_empty() { "(handler never ran)" } else { handled.trim() }
    );
}
