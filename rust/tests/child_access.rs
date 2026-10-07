//! Regression tests for issue #20: callers can inspect and stop the active
//! child through a public child handle.
//!
//! JavaScript mirrors this contract in `js/tests/child-access.test.mjs`. Rust
//! requires the explicit asynchronous `start()` step before borrowing a child;
//! once started, signalling the handle itself delegates to the runner's
//! process-group-aware termination behavior.

use command_stream::{ProcessRunner, RunOptions};
use std::time::{Duration, Instant};

#[cfg(unix)]
const IDLE_COMMAND: &str = "/bin/sleep 5";
#[cfg(windows)]
const IDLE_COMMAND: &str = "ping -n 6 127.0.0.1";

fn quiet() -> RunOptions {
    RunOptions {
        mirror: false,
        capture: true,
        ..Default::default()
    }
}

// A synchronous Windows taskkill or an inherited output pipe can block the
// Tokio runtime itself. A separate test process keeps either failure bounded
// and exposes opt-in runner traces instead of consuming the whole CI job.
fn run_bounded(test_name: &str) -> bool {
    const PROBE: &str = "COMMAND_STREAM_CHILD_ACCESS_PROBE";
    if std::env::var(PROBE).as_deref() == Ok(test_name) {
        return false;
    }
    for attempt in 0..if cfg!(windows) { 8 } else { 1 } {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([test_name, "--exact", "--nocapture"])
            .env(PROBE, test_name)
            .env(
                "COMMAND_STREAM_TRACE",
                if attempt % 2 == 0 { "false" } else { "true" },
            )
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success(), "{test_name}, attempt {attempt}: {status}");
                break;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("{test_name}, attempt {attempt}: cancellation exceeded 10 seconds");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    true
}

#[tokio::test]
async fn child_is_none_before_start() {
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());

    assert!(runner.child().is_none());
}

#[tokio::test]
async fn child_exposes_the_native_process_after_start() {
    if run_bounded("child_exposes_the_native_process_after_start") {
        return;
    }
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());
    runner.start().await.unwrap();
    let runner_pid = runner.pid();

    {
        let child = runner.child().expect("a real command has a child");
        assert_eq!(child.pid(), runner_pid);
        assert_eq!(child.native().id(), runner_pid);
    }

    runner.kill().unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(2), runner.run())
        .await
        .expect("cancelled child waited for inherited output pipes");
}

#[tokio::test]
async fn child_handle_can_stop_the_process() {
    if run_bounded("child_handle_can_stop_the_process") {
        return;
    }
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());
    runner.start().await.unwrap();

    runner
        .child()
        .expect("a real command has a child")
        .kill_with("SIGTERM")
        .unwrap();

    let result = tokio::time::timeout(Duration::from_secs(2), runner.run())
        .await
        .expect("cancelled child waited for inherited output pipes")
        .unwrap();
    assert_ne!(result.code, 0);
    assert!(runner.is_finished());
    assert!(runner.child().is_none());
}

#[tokio::test]
async fn builtin_commands_have_no_operating_system_child() {
    let mut runner = ProcessRunner::new("echo hello", quiet());
    runner.start().await.unwrap();

    assert!(runner.child().is_none());
    assert!(runner.is_finished());
}
