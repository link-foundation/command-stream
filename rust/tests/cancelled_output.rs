//! A cancelled process must not wait for a descendant's inherited pipes.
#![cfg(unix)]

use command_stream::{ProcessRunner, RunOptions, StdinOption};
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use std::path::PathBuf;
use std::time::Duration;

struct PipeHolder(PathBuf);

impl Drop for PipeHolder {
    fn drop(&mut self) {
        if let Ok(pid) = std::fs::read_to_string(&self.0).unwrap_or_default().parse() {
            let _ = kill(Pid::from_raw(pid), Signal::SIGKILL);
        }
    }
}

#[tokio::test]
async fn cancelled_runner_keeps_buffered_output_without_waiting_for_pipe_eof() {
    let directory = tempfile::tempdir().unwrap();
    let binary = directory.path().join("pipe-holder");
    let status = std::process::Command::new("rustc")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../experiments/issue-204/pipe-holder.rs"
        ))
        .arg("-o")
        .arg(&binary)
        .status()
        .unwrap();
    assert!(status.success());
    let holder = PipeHolder(directory.path().join("ready"));
    let command = format!(
        "{} {}",
        command_stream::quote(&binary.to_string_lossy()),
        command_stream::quote(&holder.0.to_string_lossy())
    );
    let mut runner = ProcessRunner::new(
        command,
        RunOptions {
            mirror: false,
            stdin: StdinOption::Null,
            ..Default::default()
        },
    );
    runner.start().await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while !holder.0.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the finite pipe holder did not start");
    runner.kill().unwrap();

    let result = tokio::time::timeout(Duration::from_millis(500), runner.run())
        .await
        .expect("cancelled runner waited for an inherited pipe to reach EOF")
        .unwrap();
    assert_eq!(result.stdout, "held stdout");
    assert_eq!(result.stderr, "held stderr");
    assert_ne!(result.code, 0);
    assert!(runner.is_finished());
    let pid = std::fs::read_to_string(&holder.0).unwrap().parse().unwrap();
    assert!(kill(Pid::from_raw(pid), None).is_ok());
}

#[tokio::test]
async fn cancelled_runner_drains_large_output_during_graceful_shutdown() {
    const CHUNK: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const REPEATS: usize = 4096;
    let directory = tempfile::tempdir().unwrap();
    let ready = directory.path().join("ready");
    let command = format!(
        "on_term() {{ i=0; while [ \"$i\" -lt {REPEATS} ]; do printf '{CHUNK}'; \
         i=$((i + 1)); done; exit 0; }}; trap on_term TERM; \
         printf ready > {}; sleep 2",
        command_stream::quote(&ready.to_string_lossy())
    );
    let mut runner = ProcessRunner::new(
        command,
        RunOptions {
            mirror: false,
            stdin: StdinOption::Null,
            kill_grace_ms: 1000,
            ..Default::default()
        },
    );
    runner.start().await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while !ready.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the graceful child did not start");
    runner.kill().unwrap();

    let result = tokio::time::timeout(Duration::from_secs(3), runner.run())
        .await
        .expect("graceful shutdown stopped draining output")
        .unwrap();
    assert_eq!(result.code, 0);
    assert_eq!(result.stdout, CHUNK.repeat(REPEATS));
}
