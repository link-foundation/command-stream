//! Integration tests for virtual command system
//!
//! These tests mirror the JavaScript tests in js/tests/virtual.test.mjs

use command_stream::commands::{
    are_virtual_commands_enabled, disable_virtual_commands, enable_virtual_commands,
    CommandContext, VirtualCommandRegistry,
};
use command_stream::{run, Pipeline, ProcessRunner, RunOptions, StdinOption};
use tokio::sync::{Mutex, MutexGuard};

static VIRTUAL_COMMANDS_TEST_LOCK: Mutex<()> = Mutex::const_new(());

async fn lock_virtual_commands() -> MutexGuard<'static, ()> {
    VIRTUAL_COMMANDS_TEST_LOCK.lock().await
}

// ============================================================================
// Virtual Commands Enable/Disable Tests
// ============================================================================

#[tokio::test]
async fn test_virtual_commands_default_enabled() {
    let _guard = lock_virtual_commands().await;
    assert!(are_virtual_commands_enabled());
}

#[tokio::test]
async fn test_disable_virtual_commands() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands(); // Ensure enabled first
    disable_virtual_commands();
    assert!(!are_virtual_commands_enabled());
    enable_virtual_commands(); // Restore
}

#[tokio::test]
async fn test_enable_virtual_commands() {
    let _guard = lock_virtual_commands().await;
    disable_virtual_commands();
    enable_virtual_commands();
    assert!(are_virtual_commands_enabled());
}

// ============================================================================
// Virtual Command Registry Tests
// ============================================================================

#[test]
fn test_registry_new() {
    let registry = VirtualCommandRegistry::new();
    assert!(registry.list().is_empty());
}

#[test]
fn test_registry_contains() {
    let registry = VirtualCommandRegistry::new();
    assert!(!registry.contains("nonexistent"));
}

// ============================================================================
// CommandContext Tests
// ============================================================================

#[test]
fn test_command_context_new() {
    let ctx = CommandContext::new(vec!["arg1".to_string(), "arg2".to_string()]);
    assert_eq!(ctx.args.len(), 2);
    assert_eq!(ctx.args[0], "arg1");
    assert_eq!(ctx.args[1], "arg2");
}

#[test]
fn test_command_context_get_cwd() {
    let ctx = CommandContext::new(vec![]);
    let cwd = ctx.get_cwd();
    assert!(cwd.exists());
}

#[test]
fn test_command_context_with_cwd() {
    let ctx = CommandContext {
        args: vec![],
        stdin: None,
        cwd: Some(std::path::PathBuf::from("/tmp")),
        env: None,
        output_tx: None,
        is_cancelled: None,
    };
    assert_eq!(ctx.get_cwd(), std::path::PathBuf::from("/tmp"));
}

#[test]
fn test_command_context_is_cancelled_default() {
    let ctx = CommandContext::new(vec![]);
    assert!(!ctx.is_cancelled());
}

#[test]
fn test_command_context_is_cancelled_with_fn() {
    let ctx = CommandContext {
        args: vec![],
        stdin: None,
        cwd: None,
        env: None,
        output_tx: None,
        is_cancelled: Some(Box::new(|| true)),
    };
    assert!(ctx.is_cancelled());
}

// ============================================================================
// Built-in Command Execution Tests
// ============================================================================

#[tokio::test]
async fn test_execute_virtual_echo() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("echo Hello World").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("Hello World"));
}

// Quote removal for embedded quotes (issue #48): a search term whose value
// contains a space, e.g. `gh issue list --label "help wanted"`, must reach the
// virtual command as a single argument with the quotes removed.
#[tokio::test]
async fn test_execute_virtual_echo_embedded_single_quotes() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("echo label:'help wanted'").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout.trim_end(), "label:help wanted");
}

#[tokio::test]
async fn test_execute_virtual_echo_embedded_double_quotes() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("echo label:\"help wanted\"").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout.trim_end(), "label:help wanted");
}

#[tokio::test]
async fn test_execute_virtual_echo_multiple_embedded_terms() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("echo label:'help wanted' is:open").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout.trim_end(), "label:help wanted is:open");
}

#[tokio::test]
async fn test_execute_virtual_pwd() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("pwd").await.unwrap();
    assert!(result.is_success());
    assert!(!result.stdout.is_empty());
}

#[tokio::test]
async fn test_execute_virtual_true() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("true").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.code, 0);
}

#[tokio::test]
async fn test_execute_virtual_false() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("false").await.unwrap();
    assert!(!result.is_success());
    assert_eq!(result.code, 1);
}

#[tokio::test]
async fn test_execute_virtual_exit() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();

    let result = run("exit 0").await.unwrap();
    assert_eq!(result.code, 0);

    let result = run("exit 42").await.unwrap();
    assert_eq!(result.code, 42);
}

#[tokio::test]
async fn test_execute_virtual_which() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("which echo").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("shell builtin"));
}

#[tokio::test]
async fn test_execute_virtual_sleep() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let start = std::time::Instant::now();
    let result = run("sleep 0.1").await.unwrap();
    let elapsed = start.elapsed();

    assert!(result.is_success());
    assert!(elapsed.as_millis() >= 90);
    assert!(elapsed.as_millis() < 300);
}

#[tokio::test]
async fn test_execute_echo_with_n_flag() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = run("echo -n Hello").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout, "Hello");
}

// ============================================================================
// Process Runner with Virtual Commands Tests
// ============================================================================

#[tokio::test]
async fn test_process_runner_virtual_echo() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let mut runner = ProcessRunner::new("echo test virtual", RunOptions::default());
    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("test virtual"));
}

#[tokio::test]
async fn test_process_runner_virtual_pwd() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let mut runner = ProcessRunner::new("pwd", RunOptions::default());
    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert!(!result.stdout.is_empty());
}

// ============================================================================
// Virtual Command Stdin Tests
// ============================================================================

// `StdinOption` keeps stdio modes and input data in separate variants, so a
// mode can never be mistaken for input the way it was in JavaScript (issue #14).
#[tokio::test]
async fn test_stdin_mode_is_not_virtual_command_input() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let options = RunOptions {
        stdin: StdinOption::Inherit,
        ..Default::default()
    };
    let mut runner = ProcessRunner::new("cat", options);
    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout, "");
}

#[tokio::test]
async fn test_stdin_content_reaches_virtual_command() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let options = RunOptions {
        stdin: StdinOption::Content("from option\n".to_string()),
        ..Default::default()
    };
    let mut runner = ProcessRunner::new("cat", options);
    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout, "from option\n");
}

#[tokio::test]
async fn test_piped_input_wins_over_pipeline_stdin() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let result = Pipeline::new()
        .add("echo piped")
        .add("cat")
        .stdin("from option\n")
        .run()
        .await
        .unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout, "piped\n");
}

// Mirrors the `tee` pipeline example in rust/README.md.
#[tokio::test]
async fn test_readme_tee_pipeline_example() {
    let _guard = lock_virtual_commands().await;
    enable_virtual_commands();
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("deploy.log");
    let result = Pipeline::new()
        .add("echo deploying")
        .add(format!("tee {}", log.display()))
        .run()
        .await
        .unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout, "deploying\n");
    assert_eq!(std::fs::read_to_string(&log).unwrap(), "deploying\n");
}
