//! Integration tests for issue #18: reading the process id of a started
//! command.
//!
//! These mirror `js/tests/process-pid.test.mjs`. Before the fix neither
//! implementation exposed the id at all: `ProcessRunner::run` takes the child
//! handle in order to await it, and `StreamingRunner` spawns its child inside a
//! background task, so nothing was reachable from the public API.

use command_stream::{OutputChunk, ProcessRunner, RunOptions, StreamingRunner};

/// A real (non built-in) command that idles long enough to be observed, and the
/// same thing again as a quick command. Written per platform because the shells
/// involved share no syntax for sleeping.
#[cfg(unix)]
const IDLE_COMMAND: &str = "/bin/sleep 5";
#[cfg(windows)]
const IDLE_COMMAND: &str = "ping -n 6 127.0.0.1";

#[cfg(unix)]
const QUICK_COMMAND: &str = "/bin/echo hi";
#[cfg(windows)]
const QUICK_COMMAND: &str = "cmd /c echo hi";

fn quiet() -> RunOptions {
    RunOptions {
        mirror: false,
        capture: true,
        ..Default::default()
    }
}

#[tokio::test]
async fn pid_is_none_before_the_command_starts() {
    let runner = ProcessRunner::new(QUICK_COMMAND, quiet());
    assert_eq!(runner.pid(), None);
}

#[tokio::test]
async fn pid_is_available_after_start() {
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());
    runner.start().await.unwrap();

    let pid = runner.pid().expect("a spawned command has a pid");
    assert!(pid > 0);

    runner.kill().unwrap();
    let _ = runner.run().await;
}

#[tokio::test]
async fn pid_survives_completion() {
    let mut runner = ProcessRunner::new(QUICK_COMMAND, quiet());
    runner.start().await.unwrap();
    let while_running = runner.pid().expect("a spawned command has a pid");

    runner.run().await.unwrap();

    // The point of recording it at spawn time: `run()` consumed the child
    // handle, so the id could no longer be recovered from it.
    assert!(runner.is_finished());
    assert_eq!(runner.pid(), Some(while_running));
}

#[tokio::test]
async fn pid_is_available_after_a_plain_run() {
    let mut runner = ProcessRunner::new(QUICK_COMMAND, quiet());
    let result = runner.run().await.unwrap();

    assert!(result.is_success());
    assert!(runner.pid().is_some());
}

#[tokio::test]
async fn pid_stays_none_for_builtin_commands() {
    // `echo` is a built-in: it runs inside this process, so there is no
    // operating system process to identify.
    let mut runner = ProcessRunner::new("echo hello", quiet());
    let result = runner.run().await.unwrap();

    assert!(result.stdout.contains("hello"));
    assert_eq!(runner.pid(), None);
}

#[tokio::test]
async fn distinct_commands_report_distinct_pids() {
    let mut first = ProcessRunner::new(IDLE_COMMAND, quiet());
    let mut second = ProcessRunner::new(IDLE_COMMAND, quiet());
    first.start().await.unwrap();
    second.start().await.unwrap();

    assert_ne!(first.pid(), second.pid());

    first.kill().unwrap();
    second.kill().unwrap();
    let _ = first.run().await;
    let _ = second.run().await;
}

#[tokio::test]
async fn streaming_pid_resolves_once_the_child_exists() {
    let mut stream = StreamingRunner::new(QUICK_COMMAND).stream();

    let pid = stream.wait_for_pid().await.expect("the child was spawned");
    assert!(pid > 0);

    // Draining to the exit chunk proves the id belongs to the process that
    // actually ran, not to a handle abandoned on the way.
    let mut exit_code = None;
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Exit(code) = chunk {
            exit_code = Some(code);
        }
    }

    assert_eq!(exit_code, Some(0));
    assert_eq!(stream.pid(), Some(pid));
}

#[tokio::test]
async fn streaming_pid_is_set_by_the_time_output_arrives() {
    let mut stream = StreamingRunner::new(QUICK_COMMAND).stream();

    let mut pid_at_first_chunk = None;
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Stdout(_) = chunk {
            pid_at_first_chunk = stream.pid();
            break;
        }
    }

    assert!(
        pid_at_first_chunk.is_some(),
        "the id is published before the first chunk is sent"
    );
}

/// `ps` is the reference for "which process is this really?", and it is POSIX
/// only. The behavior it pins down - a command string being run *by a shell*,
/// so the id names that shell - is not Unix-specific, but its verification is.
#[cfg(unix)]
#[tokio::test]
async fn a_shell_command_reports_the_shell_that_runs_it() {
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());
    runner.start().await.unwrap();
    let pid = runner.pid().expect("a spawned command has a pid");

    let ps = std::process::Command::new("ps")
        .args(["-o", "args=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    let args = String::from_utf8_lossy(&ps.stdout).trim().to_string();

    assert!(args.contains("/bin/sleep 5"), "unexpected process: {args}");
    assert_ne!(args, "/bin/sleep 5", "expected a shell wrapper");

    runner.kill().unwrap();
    let _ = runner.run().await;
}

/// The child is spawned into its own process group, which is what lets `kill()`
/// reach the command running underneath the shell. The group is named by the
/// reported id, so a caller can signal the group themselves.
#[cfg(unix)]
#[tokio::test]
async fn the_reported_id_leads_its_own_process_group() {
    let mut runner = ProcessRunner::new(IDLE_COMMAND, quiet());
    runner.start().await.unwrap();
    let pid = runner.pid().expect("a spawned command has a pid");

    let ps = std::process::Command::new("ps")
        .args(["-o", "pgid=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    let pgid: u32 = String::from_utf8_lossy(&ps.stdout).trim().parse().unwrap();

    assert_eq!(pgid, pid);

    runner.kill().unwrap();
    let _ = runner.run().await;
}

/// A missing command is reported by the shell that was asked to run it, so the
/// shell still has an id even though nothing the caller asked for ran.
#[tokio::test]
async fn a_missing_command_still_names_the_shell_that_looked_for_it() {
    let mut runner = ProcessRunner::new("command-stream-no-such-executable --nope", quiet());
    let result = runner.run().await.unwrap();

    assert_eq!(result.code, 127); // "command not found"
    assert!(runner.pid().is_some());
}

/// `wait_for_pid` must not wait forever when the process never comes into
/// existence: the task drops the publishing end, which ends the wait.
#[tokio::test]
async fn streaming_wait_for_pid_gives_up_when_the_spawn_fails() {
    let mut stream =
        StreamingRunner::from_argv("command-stream-no-such-executable", ["--nope"]).stream();

    let pid = tokio::time::timeout(std::time::Duration::from_secs(5), stream.wait_for_pid())
        .await
        .expect("wait_for_pid returns instead of hanging");

    assert_eq!(pid, None);
    assert_eq!(stream.pid(), None);
}
