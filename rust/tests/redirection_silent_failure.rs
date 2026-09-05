//! Issue #46: a command whose first word is also a virtual command used to be
//! dispatched to that virtual command with the shell operators still in the
//! argument list. Virtual command arguments come from splitting on whitespace,
//! so `echo hello > out.txt` printed `hello > out.txt` and wrote no file, and
//! `git push ... 2>&1` reported success while nothing had been pushed.
//!
//! These tests mirror js/tests/redirection-silent-failure.test.mjs: every case
//! is compared against `/bin/sh`, which is the contract.

#![cfg(unix)]

use command_stream::{needs_real_shell, ProcessRunner, RunOptions};
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

/// Run `command` in `dir` through /bin/sh and return (exit code, stdout).
fn run_in_sh(command: &str, dir: &Path) -> (i32, String) {
    let output = Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .current_dir(dir)
        .output()
        .expect("failed to run /bin/sh");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
    )
}

/// List the directory as sorted `name:contents` pairs.
fn snapshot(dir: &Path) -> Vec<String> {
    let mut entries: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            let contents = std::fs::read_to_string(entry.path()).unwrap_or_default();
            format!("{}:{}", name, contents)
        })
        .collect();
    entries.sort();
    entries
}

/// Create a scratch directory holding the `seed.txt` the cases read from.
fn scratch() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("seed.txt"), "seeded\n").unwrap();
    dir
}

async fn assert_matches_sh(command: &str) {
    let sh_dir = scratch();
    let cs_dir = scratch();

    let (expected_code, expected_stdout) = run_in_sh(command, sh_dir.path());

    let mut runner = ProcessRunner::new(
        command,
        RunOptions {
            mirror: false,
            cwd: Some(cs_dir.path().to_path_buf()),
            ..Default::default()
        },
    );
    let result = runner.run().await.unwrap();

    assert_eq!(
        result.stdout, expected_stdout,
        "stdout mismatch for {:?}",
        command
    );
    assert_eq!(
        result.code, expected_code,
        "exit code mismatch for {:?}",
        command
    );
    assert_eq!(
        snapshot(cs_dir.path()),
        snapshot(sh_dir.path()),
        "written files mismatch for {:?}",
        command
    );
}

/// Every command starts with a word that is also a virtual command, which is
/// exactly the shape that used to bypass the shell.
#[tokio::test]
async fn redirection_on_virtual_commands_matches_sh() {
    for command in [
        "echo hello > out.txt",
        "echo hello >> out.txt",
        "echo hello 1> out.txt",
        "echo one two > out.txt",
        "echo hello 2> err.txt",
        "true > out.txt",
        "seq 1 3 > out.txt",
        "basename /a/b > out.txt",
        "cat < seed.txt",
        "cat 0< seed.txt",
        "cat /definitely/missing/path 2>/dev/null",
        "ls /definitely/missing/path 2>&1",
        "echo a > out.txt && echo b >> out.txt",
        "false > out.txt || echo fallback > out.txt",
        // Quoted redirection characters are literal in sh, so they must stay
        // literal here too - the fix must not over-reach.
        "echo \"a > b\"",
        "echo 'a > b'",
    ] {
        assert_matches_sh(command).await;
    }
}

/// Expansions reached the virtual commands through the same gap.
#[tokio::test]
async fn expansions_on_virtual_commands_match_sh() {
    for command in [
        "echo $HOME",
        "echo *",
        "echo ~",
        "echo `echo hi`",
        "echo $(echo hi)",
    ] {
        assert_matches_sh(command).await;
    }
}

#[tokio::test]
async fn failing_git_push_reports_the_failure_through_redirection() {
    // A local path that is not a repository fails the same way everywhere and
    // keeps the test off the network.
    let dir = TempDir::new().unwrap();
    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).unwrap();

    for args in [
        vec!["init", "-q"],
        vec!["config", "user.email", "test@example.com"],
        vec!["config", "user.name", "Test"],
    ] {
        Command::new("git")
            .args(&args)
            .current_dir(&repo)
            .output()
            .unwrap();
    }
    std::fs::write(repo.join("file.txt"), "content\n").unwrap();
    Command::new("git")
        .args(["add", "file.txt"])
        .current_dir(&repo)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-q", "-m", "initial"])
        .current_dir(&repo)
        .output()
        .unwrap();
    Command::new("git")
        .args(["remote", "add", "origin"])
        .arg(dir.path().join("no-such-remote"))
        .current_dir(&repo)
        .output()
        .unwrap();

    let mut runner = ProcessRunner::new(
        "git push origin HEAD 2>&1",
        RunOptions {
            mirror: false,
            cwd: Some(repo.clone()),
            ..Default::default()
        },
    );
    let result = runner.run().await.unwrap();

    // Before the fix this was code 0 with an empty stdout.
    assert_ne!(result.code, 0, "git push should have failed");
    assert!(
        result.stdout.contains("fatal:"),
        "expected git's error on stdout, got {:?}",
        result.stdout
    );
}

#[test]
fn needs_real_shell_recognises_redirection() {
    assert!(needs_real_shell("echo hello > out.txt"));
    assert!(needs_real_shell("echo hello >> out.txt"));
    assert!(needs_real_shell("cat < in.txt"));
    assert!(needs_real_shell("git push origin main 2>&1"));
    assert!(needs_real_shell("cat <<EOF"));

    assert!(!needs_real_shell("echo hello"));
    assert!(!needs_real_shell("ls | grep foo"));
}
