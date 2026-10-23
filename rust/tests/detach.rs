//! Regression tests for issue #232: a fire-and-forget command keeps running
//! after the caller drops its handle or exits, and its pid is returned.
#![cfg(unix)]

use command_stream::{ProcessRunner, RunOptions, StreamingRunner};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

const PROBE: &str = "COMMAND_STREAM_DETACH_PROBE";

async fn wait_for_file(path: &Path) -> String {
    for _ in 0..250 {
        if let Ok(text) = std::fs::read_to_string(path) {
            if text.ends_with('\n') {
                return text;
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("{} was never written", path.display());
}

#[tokio::test]
async fn streaming_runner_detach_returns_the_pid_and_honours_cwd_and_env() {
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("COMMAND_STREAM_DETACH_REMOVED", "inherited");
    let pid = StreamingRunner::from_argv(
        "/bin/sh",
        [
            "-c",
            "echo \"$$ $(pwd -P) $DETACH_VALUE ${COMMAND_STREAM_DETACH_REMOVED-unset}\" > out",
        ],
    )
    .cwd(dir.path())
    .env(HashMap::from([(
        "DETACH_VALUE".to_string(),
        "set".to_string(),
    )]))
    .env_remove("COMMAND_STREAM_DETACH_REMOVED")
    .detach()
    .unwrap()
    .expect("a spawned child has a pid");

    let text = wait_for_file(&dir.path().join("out")).await;
    let cwd = dir.path().canonicalize().unwrap();
    assert_eq!(text, format!("{pid} {} set unset\n", cwd.display()));
}

#[tokio::test]
async fn detached_child_leads_its_own_process_group() {
    let pid = StreamingRunner::from_argv("sleep", ["2"])
        .detach()
        .unwrap()
        .unwrap();
    let child = nix::unistd::Pid::from_raw(pid as i32);
    let group = nix::unistd::getpgid(Some(child)).unwrap();
    assert_eq!(group, child, "a CTRL+C to the caller's group must miss it");
    assert_ne!(group, nix::unistd::getpgrp());
    let _ = nix::sys::signal::kill(child, nix::sys::signal::Signal::SIGKILL);
}

#[tokio::test]
async fn process_runner_spawn_detached_runs_through_the_shell() {
    let dir = tempfile::tempdir().unwrap();
    let runner = ProcessRunner::new(
        "echo \"$DETACH_VALUE\" > out",
        RunOptions {
            cwd: Some(dir.path().to_path_buf()),
            env: Some(HashMap::from([(
                "DETACH_VALUE".to_string(),
                "from-runner".to_string(),
            )])),
            ..Default::default()
        },
    );
    let pid = runner.spawn_detached().unwrap();
    assert!(pid.is_some());
    assert!(!runner.is_finished(), "the runner itself is left unstarted");
    drop(runner);

    assert_eq!(
        wait_for_file(&dir.path().join("out")).await,
        "from-runner\n"
    );
}

/// The probe half of `detached_child_outlives_the_caller`: detach a delayed
/// write, then return so the probe process exits before the write happens.
#[test]
fn detach_probe() {
    let Ok(dir) = std::env::var(PROBE) else {
        return;
    };
    let pid = StreamingRunner::new("sleep 0.5; echo alive > alive")
        .cwd(dir)
        .detach()
        .unwrap();
    println!("detached pid {pid:?}");
}

#[tokio::test]
async fn detached_child_outlives_the_caller() {
    let dir = tempfile::tempdir().unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "detach_probe", "--nocapture"])
        .env(PROBE, dir.path())
        .stdout(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
    let alive = dir.path().join("alive");
    assert!(
        !alive.exists(),
        "the probe exited before its child finished"
    );

    assert_eq!(wait_for_file(&alive).await, "alive\n");
}
