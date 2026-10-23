//! Regression tests for issue #227: a `timeout` bounds the command, and the
//! result says the timeout - not the command - ended it.
//!
//! JavaScript mirrors this contract in `js/tests/timeout-option.test.mjs`.
#![cfg(unix)]

use command_stream::{OutputChunk, ProcessRunner, RunOptions, StreamingRunner};
use std::time::{Duration, Instant};

fn quiet() -> RunOptions {
    RunOptions {
        mirror: false,
        ..Default::default()
    }
}

#[tokio::test]
async fn process_runner_timeout_stops_a_long_command() {
    let started = Instant::now();
    let mut runner = ProcessRunner::new(
        "/bin/sleep 5",
        RunOptions {
            timeout: Some(Duration::from_millis(300)),
            ..quiet()
        },
    );
    let result = runner.run().await.unwrap();

    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(result.code, 143, "SIGTERM is reported as 128 + 15");
    assert!(runner.timed_out());
}

#[tokio::test]
async fn process_runner_timeout_keeps_output_written_before_it() {
    let mut runner = ProcessRunner::new(
        "echo before; /bin/sleep 5; echo after",
        RunOptions {
            timeout: Some(Duration::from_millis(500)),
            ..quiet()
        },
    );
    let result = runner.run().await.unwrap();

    assert_eq!(result.stdout, "before\n");
    assert!(runner.timed_out());
}

#[tokio::test]
async fn process_runner_timeout_uses_the_kill_signal() {
    let mut runner = ProcessRunner::new(
        "/bin/sleep 5",
        RunOptions {
            timeout: Some(Duration::from_millis(200)),
            kill_signal: "SIGINT".to_string(),
            ..quiet()
        },
    );
    let result = runner.run().await.unwrap();

    assert_eq!(result.code, 130);
    assert!(runner.timed_out());
}

#[tokio::test]
async fn process_runner_timeout_escalates_when_the_signal_is_ignored() {
    let started = Instant::now();
    let mut runner = ProcessRunner::new(
        "trap '' TERM; /bin/sleep 5",
        RunOptions {
            timeout: Some(Duration::from_millis(200)),
            kill_grace_ms: 200,
            ..quiet()
        },
    );
    let result = runner.run().await.unwrap();

    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(result.code, 143);
    assert!(runner.timed_out());
}

#[tokio::test]
async fn process_runner_timeout_bounds_virtual_commands() {
    let started = Instant::now();
    let mut runner = ProcessRunner::new(
        "sleep 5",
        RunOptions {
            timeout: Some(Duration::from_millis(200)),
            ..quiet()
        },
    );
    let result = runner.run().await.unwrap();

    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(result.code, 143);
    assert!(runner.timed_out());
}

#[tokio::test]
async fn process_runner_finishing_in_time_is_not_timed_out() {
    let mut runner = ProcessRunner::new(
        "/bin/echo done",
        RunOptions {
            timeout: Some(Duration::from_secs(10)),
            ..quiet()
        },
    );
    let result = runner.run().await.unwrap();

    assert_eq!(result.code, 0);
    assert_eq!(result.stdout, "done\n");
    assert!(!runner.timed_out());
}

#[tokio::test]
async fn process_runner_without_timeout_is_not_timed_out() {
    let mut runner = ProcessRunner::new("/bin/sh -c 'exit 3'", quiet());
    let result = runner.run().await.unwrap();

    assert_eq!(result.code, 3);
    assert!(!runner.timed_out());
}

#[tokio::test]
async fn streaming_timeout_stops_the_stream() {
    let started = Instant::now();
    let mut stream = StreamingRunner::from_argv("/bin/sh", ["-c", "echo ready; exec sleep 5"])
        .timeout(Duration::from_millis(300))
        .stream();
    let mut stdout = Vec::new();
    let mut exit = None;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(data) => stdout.extend(data),
            OutputChunk::Stderr(_) => {}
            OutputChunk::Exit(code) => {
                exit = Some(code);
                assert!(stream.timed_out(), "timed_out is set before the Exit chunk");
            }
        }
    }

    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(stdout, b"ready\n");
    assert_eq!(exit, Some(143));
    assert_eq!(stream.exit_signal().as_deref(), Some("SIGTERM"));
}

#[tokio::test]
async fn streaming_collect_honours_the_timeout() {
    let started = Instant::now();
    let result = StreamingRunner::new("sleep 5")
        .timeout(Duration::from_millis(200))
        .kill_signal("SIGINT")
        .collect()
        .await
        .unwrap();

    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(result.code, 130);
}

#[tokio::test]
async fn streaming_explicit_kill_is_not_a_timeout() {
    let mut stream = StreamingRunner::new("sleep 5")
        .timeout(Duration::from_secs(30))
        .stream();
    stream.wait_for_pid().await;
    stream.kill();
    let mut exit = None;
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Exit(code) = chunk {
            exit = Some(code);
        }
    }

    assert_eq!(exit, Some(143));
    assert!(!stream.timed_out());
}
