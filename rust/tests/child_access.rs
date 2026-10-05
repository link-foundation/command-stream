//! Regression tests for issue #20: callers can inspect and stop the active
//! child through a public child handle.
//!
//! JavaScript mirrors this contract in `js/tests/child-access.test.mjs`. Rust
//! requires the explicit asynchronous `start()` step before borrowing a child;
//! once started, signalling the handle itself delegates to the runner's
//! process-group-aware termination behavior.

use command_stream::{ProcessRunner, RunOptions};

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

#[tokio::test]
async fn child_is_none_before_start() {
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());

    assert!(runner.child().is_none());
}

#[tokio::test]
async fn child_exposes_the_native_process_after_start() {
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());
    runner.start().await.unwrap();
    let runner_pid = runner.pid();

    {
        let child = runner.child().expect("a real command has a child");
        assert_eq!(child.pid(), runner_pid);
        assert_eq!(child.native().id(), runner_pid);
    }

    runner.kill().unwrap();
    let _ = runner.run().await;
}

#[tokio::test]
async fn child_handle_can_stop_the_process() {
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());
    runner.start().await.unwrap();

    runner
        .child()
        .expect("a real command has a child")
        .kill_with("SIGTERM")
        .unwrap();

    let result = runner.run().await.unwrap();
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
