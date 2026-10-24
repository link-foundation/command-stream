//! Regression tests for issue #230: `ProcessRunner::from_argv` runs an exact
//! argv without the shell or virtual commands, and keeps live stdin.
#![cfg(unix)]

use command_stream::{ProcessRunner, RunOptions, StdinOption};

fn quiet() -> RunOptions {
    RunOptions {
        mirror: false,
        ..Default::default()
    }
}

#[tokio::test]
async fn from_argv_passes_arguments_verbatim() {
    // `echo` is also a virtual command, and `$HOME` would be expanded by a
    // shell: neither may happen for an exact argv.
    let mut runner = ProcessRunner::from_argv("echo", ["$HOME", "a  b", "'q'"], quiet());
    let result = runner.run().await.unwrap();
    assert_eq!(result.code, 0);
    assert_eq!(result.stdout, "$HOME a  b 'q'\n");
}

#[tokio::test]
async fn from_argv_reports_a_quoted_command_string() {
    let runner = ProcessRunner::from_argv("printf", ["%s", "a b"], quiet());
    assert_eq!(runner.command(), "printf '%s' 'a b'");
}

#[tokio::test]
async fn from_argv_keeps_live_stdin() {
    let mut runner = ProcessRunner::from_argv(
        "sed",
        ["-u", "s/^/got: /"],
        RunOptions {
            stdin: StdinOption::Pipe,
            ..quiet()
        },
    );
    runner.start().await.unwrap();
    runner.write_stdin(b"one\n").await.unwrap();
    runner.write_stdin(b"two\n").await.unwrap();
    runner.close_stdin().await.unwrap();
    let result = runner.run().await.unwrap();
    assert_eq!(result.code, 0);
    assert_eq!(result.stdout, "got: one\ngot: two\n");
}

#[tokio::test]
async fn from_argv_honours_cwd_env_and_env_remove() {
    std::env::set_var("PROCESS_ARGV_INHERITED", "leaked");
    let dir = tempfile::tempdir().unwrap();
    let mut runner = ProcessRunner::from_argv(
        "/bin/sh",
        [
            "-c",
            "printf '%s|%s|%s' \"$(pwd -P)\" \"$ADDED\" \"${PROCESS_ARGV_INHERITED:-unset}\"",
        ],
        RunOptions {
            cwd: Some(dir.path().to_path_buf()),
            env: Some([("ADDED".to_string(), "yes".to_string())].into()),
            env_remove: vec!["PROCESS_ARGV_INHERITED".to_string()],
            ..quiet()
        },
    );
    let result = runner.run().await.unwrap();
    let expected_dir = dir.path().canonicalize().unwrap();
    assert_eq!(
        result.stdout,
        format!("{}|yes|unset", expected_dir.display())
    );
}

#[tokio::test]
async fn from_argv_reports_a_missing_program() {
    let mut runner = ProcessRunner::from_argv("command-stream-no-such-program", ["x"], quiet());
    assert!(runner.start().await.is_err());
}
