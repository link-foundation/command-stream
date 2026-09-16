//! Signal handling tests (issue #15).
//!
//! These cover the documented contract for stopping a running command: which
//! signal is delivered, that the child gets a chance to handle it, that a
//! process ignoring it is still terminated, and which exit code is reported.
//!
//! The JavaScript counterpart is `js/tests/signal-handling.test.mjs`; both
//! suites assert the same behavior so the two implementations stay in parity.
use command_stream::signal::{signal_exit_code, signal_number};
use command_stream::{OutputChunk, ProcessRunner, RunOptions, StreamingRunner};
use std::time::Duration;

/// A command that traps a signal, records that its handler ran, and exits.
///
/// Writing to a marker file is what distinguishes "the child handled the
/// signal" from "the child was destroyed before it could": an exit code alone
/// cannot tell the two apart, because the reported code is derived from the
/// signal that was requested either way.
#[cfg(unix)]
fn graceful_child(marker: &std::path::Path) -> String {
    format!(
        "trap 'echo handled >> {marker}; exit 0' TERM INT; \
         echo ready; \
         while true; do sleep 0.05; done",
        marker = marker.display()
    )
}

/// A command that ignores TERM and INT outright, so only SIGKILL stops it.
#[cfg(unix)]
fn stubborn_child() -> String {
    "trap '' TERM INT; echo ready; while true; do sleep 0.05; done".to_string()
}

/// A stubborn child that also appends to a heartbeat file while it runs.
///
/// Whether the heartbeat keeps growing is the evidence that the process is
/// still executing. Checking the pid with signal 0 would not work here: after
/// `kill()` nobody awaits the child, so it lingers as a zombie and still
/// answers signal 0 long after it stopped running.
#[cfg(unix)]
fn stubborn_heartbeat_child(heartbeat: &std::path::Path) -> String {
    format!(
        "trap '' TERM INT; \
         echo ready; \
         while true; do echo tick >> {heartbeat}; sleep 0.05; done",
        heartbeat = heartbeat.display()
    )
}

#[cfg(unix)]
fn heartbeat_len(path: &std::path::Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

#[cfg(unix)]
fn handler_ran(marker: &std::path::Path) -> bool {
    std::fs::read_to_string(marker)
        .map(|text| text.contains("handled"))
        .unwrap_or(false)
}

// ============================================================================
// Exit-code convention
// ============================================================================

#[test]
fn signal_numbers_follow_the_posix_names() {
    assert_eq!(signal_number("SIGHUP"), 1);
    assert_eq!(signal_number("SIGINT"), 2);
    assert_eq!(signal_number("SIGQUIT"), 3);
    assert_eq!(signal_number("SIGKILL"), 9);
    assert_eq!(signal_number("SIGUSR1"), 10);
    assert_eq!(signal_number("SIGUSR2"), 12);
    assert_eq!(signal_number("SIGTERM"), 15);
}

#[test]
fn unknown_signal_names_fall_back_to_sigterm() {
    assert_eq!(signal_number("NOT-A-SIGNAL"), signal_number("SIGTERM"));
    assert_eq!(signal_exit_code("NOT-A-SIGNAL"), 143);
}

#[test]
fn exit_codes_follow_the_128_plus_signal_convention() {
    // The table documented in both READMEs.
    assert_eq!(signal_exit_code("SIGHUP"), 129);
    assert_eq!(signal_exit_code("SIGINT"), 130); // CTRL+C
    assert_eq!(signal_exit_code("SIGQUIT"), 131);
    assert_eq!(signal_exit_code("SIGKILL"), 137);
    assert_eq!(signal_exit_code("SIGUSR1"), 138);
    assert_eq!(signal_exit_code("SIGUSR2"), 140);
    assert_eq!(signal_exit_code("SIGTERM"), 143);
}

// ============================================================================
// ProcessRunner
// ============================================================================

/// The default stop signal is SIGTERM, and the child gets to handle it.
#[cfg(unix)]
#[tokio::test]
async fn process_runner_kill_lets_the_child_handle_sigterm() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("marker");

    let mut runner = ProcessRunner::new(
        graceful_child(&marker),
        RunOptions {
            mirror: false,
            ..Default::default()
        },
    );
    runner.start().await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    runner.kill().unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;

    assert!(
        handler_ran(&marker),
        "the child's SIGTERM handler never ran: kill() destroyed it before it could clean up"
    );
}

/// `kill_with` overrides the configured signal for a single call.
#[cfg(unix)]
#[tokio::test]
async fn process_runner_kill_with_sends_the_requested_signal() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("marker");

    let mut runner = ProcessRunner::new(
        graceful_child(&marker),
        RunOptions {
            mirror: false,
            ..Default::default()
        },
    );
    runner.start().await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    // SIGINT is the signal CTRL+C sends.
    runner.kill_with("SIGINT").unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;

    assert!(
        handler_ran(&marker),
        "the child's SIGINT handler never ran"
    );
}

/// A configured `kill_signal` is what an argument-less `kill()` delivers.
#[cfg(unix)]
#[tokio::test]
async fn process_runner_honors_the_configured_kill_signal() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("marker");

    let mut runner = ProcessRunner::new(
        // Only INT is trapped, so the marker proves SIGINT (not the SIGTERM
        // default) was the signal actually delivered.
        format!(
            "trap 'echo handled >> {marker}; exit 0' INT; echo ready; while true; do sleep 0.05; done",
            marker = marker.display()
        ),
        RunOptions {
            mirror: false,
            kill_signal: "SIGINT".to_string(),
            ..Default::default()
        },
    );
    runner.start().await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    runner.kill().unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;

    assert!(
        handler_ran(&marker),
        "kill() did not deliver the configured SIGINT"
    );
}

/// A process that ignores the signal is still terminated by the escalation.
#[cfg(unix)]
#[tokio::test]
async fn process_runner_escalates_to_sigkill_when_the_signal_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let heartbeat = dir.path().join("heartbeat");

    let mut runner = ProcessRunner::new(
        stubborn_heartbeat_child(&heartbeat),
        RunOptions {
            mirror: false,
            kill_grace_ms: 50,
            ..Default::default()
        },
    );
    runner.start().await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let while_running = heartbeat_len(&heartbeat);
    assert!(
        while_running > 0,
        "the child never started: no heartbeat was written"
    );

    runner.kill().unwrap();
    // Wait out the grace period plus the SIGKILL escalation.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let after_kill = heartbeat_len(&heartbeat);
    // If the process were still alive it would keep appending during this window.
    tokio::time::sleep(Duration::from_millis(500)).await;

    assert_eq!(
        heartbeat_len(&heartbeat),
        after_kill,
        "a process ignoring SIGTERM kept running: it was never escalated to SIGKILL"
    );
}

// ============================================================================
// StreamingRunner
// ============================================================================

/// The streaming runner gives the child the same grace period, and reports the
/// `128 + signal` exit code for the signal that was requested.
#[cfg(unix)]
#[tokio::test]
async fn stream_kill_lets_the_child_handle_the_signal() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("marker");

    let mut stream = StreamingRunner::new(graceful_child(&marker)).stream();

    let mut exit_code = None;
    let mut killed = false;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(_) if !killed => {
                killed = true;
                stream.kill();
            }
            OutputChunk::Exit(code) => exit_code = Some(code),
            _ => {}
        }
    }
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(exit_code, Some(143), "expected the SIGTERM exit code");
    assert!(
        handler_ran(&marker),
        "the child's SIGTERM handler never ran"
    );
}

/// `kill_grace_ms(0)` opts out of the grace period entirely.
#[cfg(unix)]
#[tokio::test]
async fn stream_zero_grace_escalates_immediately() {
    let mut stream = StreamingRunner::new(stubborn_child())
        .kill_grace_ms(0)
        .stream();

    let mut exit_code = None;
    let mut killed = false;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(_) if !killed => {
                killed = true;
                stream.kill();
            }
            OutputChunk::Exit(code) => exit_code = Some(code),
            _ => {}
        }
    }

    // The reported code still reflects the requested signal, even though the
    // process was actually stopped by the SIGKILL escalation.
    assert_eq!(exit_code, Some(143));
}
