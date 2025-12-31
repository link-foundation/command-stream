//! Integration tests for ProcessRunner
//!
//! These tests mirror the JavaScript $.test.mjs tests

use command_stream::{run, create, exec, ProcessRunner, RunOptions, StdinOption};
use std::collections::HashMap;
use std::path::PathBuf;
use tempfile::TempDir;

// ============================================================================
// Basic Command Execution Tests
// ============================================================================

#[tokio::test]
async fn test_simple_echo() {
    let result = run("echo hello").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello"));
}

#[tokio::test]
async fn test_echo_with_multiple_words() {
    let result = run("echo hello world").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello world"));
}

#[tokio::test]
async fn test_command_with_arguments() {
    let result = run("echo -n test").await.unwrap();
    assert!(result.is_success());
}

#[tokio::test]
async fn test_false_command_returns_nonzero() {
    let result = run("false").await.unwrap();
    assert!(!result.is_success());
    assert_eq!(result.code, 1);
}

#[tokio::test]
async fn test_true_command_returns_zero() {
    let result = run("true").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.code, 0);
}

// ============================================================================
// ProcessRunner Tests
// ============================================================================

#[tokio::test]
async fn test_process_runner_basic() {
    let mut runner = ProcessRunner::new(
        "echo hello",
        RunOptions {
            mirror: false,
            ..Default::default()
        },
    );

    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello"));
}

#[tokio::test]
async fn test_process_runner_with_capture() {
    let mut runner = ProcessRunner::new(
        "echo captured",
        RunOptions {
            mirror: false,
            capture: true,
            ..Default::default()
        },
    );

    let result = runner.run().await.unwrap();
    assert!(result.stdout.contains("captured"));
}

#[tokio::test]
async fn test_process_runner_is_finished() {
    let mut runner = ProcessRunner::new("true", RunOptions::default());

    assert!(!runner.is_finished());
    let _ = runner.run().await;
    assert!(runner.is_finished());
}

#[tokio::test]
async fn test_process_runner_result() {
    let mut runner = ProcessRunner::new("echo test", RunOptions::default());
    let _ = runner.run().await;

    let result = runner.result();
    assert!(result.is_some());
    assert!(result.unwrap().is_success());
}

// ============================================================================
// Working Directory Tests
// ============================================================================

#[tokio::test]
async fn test_custom_working_directory() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("test.txt"), "content").unwrap();

    let mut runner = ProcessRunner::new(
        "ls",
        RunOptions {
            mirror: false,
            cwd: Some(dir.path().to_path_buf()),
            ..Default::default()
        },
    );

    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("test.txt"));
}

// ============================================================================
// Environment Variables Tests
// ============================================================================

#[tokio::test]
async fn test_custom_environment_variable() {
    let mut env_vars = HashMap::new();
    env_vars.insert("MY_TEST_VAR".to_string(), "test_value".to_string());

    let mut runner = ProcessRunner::new(
        "printenv MY_TEST_VAR",
        RunOptions {
            mirror: false,
            env: Some(env_vars),
            ..Default::default()
        },
    );

    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("test_value"));
}

// ============================================================================
// Stdin Tests
// ============================================================================

#[tokio::test]
async fn test_stdin_content() {
    let mut runner = ProcessRunner::new(
        "cat",
        RunOptions {
            mirror: false,
            stdin: StdinOption::Content("hello from stdin".to_string()),
            ..Default::default()
        },
    );

    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello from stdin"));
}

// ============================================================================
// exec Function Tests
// ============================================================================

#[tokio::test]
async fn test_exec_with_options() {
    let result = exec(
        "echo test",
        RunOptions {
            mirror: false,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("test"));
}

// ============================================================================
// create Function Tests
// ============================================================================

#[tokio::test]
async fn test_create_and_run() {
    let mut runner = create("echo created", RunOptions::default());
    let result = runner.run().await.unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("created"));
}

// ============================================================================
// Virtual Command Tests
// ============================================================================

#[tokio::test]
async fn test_virtual_echo() {
    let result = run("echo virtual echo").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("virtual echo"));
}

#[tokio::test]
async fn test_virtual_pwd() {
    let result = run("pwd").await.unwrap();
    assert!(result.is_success());
    assert!(!result.stdout.is_empty());
}

#[tokio::test]
async fn test_virtual_true() {
    let result = run("true").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.code, 0);
}

#[tokio::test]
async fn test_virtual_false() {
    let result = run("false").await.unwrap();
    assert!(!result.is_success());
    assert_eq!(result.code, 1);
}

#[tokio::test]
async fn test_virtual_sleep() {
    let start = std::time::Instant::now();
    let result = run("sleep 0.05").await.unwrap();
    let elapsed = start.elapsed();

    assert!(result.is_success());
    assert!(elapsed.as_millis() >= 40);
}

// ============================================================================
// Stderr Tests
// ============================================================================

#[tokio::test]
async fn test_stderr_capture() {
    let result = run("cat nonexistent_file_12345").await.unwrap();
    assert!(!result.is_success());
    assert!(!result.stderr.is_empty());
}

// ============================================================================
// Exit Code Tests
// ============================================================================

#[tokio::test]
async fn test_exit_code_zero() {
    let result = run("exit 0").await.unwrap();
    assert_eq!(result.code, 0);
}

#[tokio::test]
async fn test_exit_code_nonzero() {
    let result = run("exit 42").await.unwrap();
    assert_eq!(result.code, 42);
}

// ============================================================================
// Kill/Cancel Tests
// ============================================================================

#[tokio::test]
async fn test_kill_process() {
    let mut runner = ProcessRunner::new(
        "sleep 10",
        RunOptions {
            mirror: false,
            ..Default::default()
        },
    );

    runner.start().await.unwrap();
    let kill_result = runner.kill();
    assert!(kill_result.is_ok());
}
