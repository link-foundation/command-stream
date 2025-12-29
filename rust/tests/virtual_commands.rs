//! Integration tests for virtual command system
//!
//! These tests mirror the JavaScript tests in js/tests/virtual.test.mjs

use command_stream::commands::{
    are_virtual_commands_enabled, disable_virtual_commands, enable_virtual_commands,
    CommandContext, VirtualCommandRegistry,
};
use command_stream::{run, ProcessRunner, RunOptions};

// ============================================================================
// Virtual Commands Enable/Disable Tests
// ============================================================================

#[test]
fn test_virtual_commands_default_enabled() {
    assert!(are_virtual_commands_enabled());
}

#[test]
fn test_disable_virtual_commands() {
    enable_virtual_commands(); // Ensure enabled first
    disable_virtual_commands();
    assert!(!are_virtual_commands_enabled());
    enable_virtual_commands(); // Restore
}

#[test]
fn test_enable_virtual_commands() {
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
    enable_virtual_commands();
    let result = run("echo Hello World").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("Hello World"));
}

#[tokio::test]
async fn test_execute_virtual_pwd() {
    enable_virtual_commands();
    let result = run("pwd").await.unwrap();
    assert!(result.is_success());
    assert!(!result.stdout.is_empty());
}

#[tokio::test]
async fn test_execute_virtual_true() {
    enable_virtual_commands();
    let result = run("true").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.code, 0);
}

#[tokio::test]
async fn test_execute_virtual_false() {
    enable_virtual_commands();
    let result = run("false").await.unwrap();
    assert!(!result.is_success());
    assert_eq!(result.code, 1);
}

#[tokio::test]
async fn test_execute_virtual_exit() {
    enable_virtual_commands();

    let result = run("exit 0").await.unwrap();
    assert_eq!(result.code, 0);

    let result = run("exit 42").await.unwrap();
    assert_eq!(result.code, 42);
}

#[tokio::test]
async fn test_execute_virtual_which() {
    enable_virtual_commands();
    let result = run("which echo").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("shell builtin"));
}

#[tokio::test]
async fn test_execute_virtual_sleep() {
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
    enable_virtual_commands();
    let result = run("echo -n Hello").await.unwrap();
    assert!(result.is_success());
    assert_eq!(result.stdout.trim(), "Hello");
    // -n flag should not add newline
    assert!(!result.stdout.ends_with("\n\n"));
}

// ============================================================================
// Process Runner with Virtual Commands Tests
// ============================================================================

#[tokio::test]
async fn test_process_runner_virtual_echo() {
    enable_virtual_commands();
    let mut runner = ProcessRunner::new("echo test virtual", RunOptions::default());
    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("test virtual"));
}

#[tokio::test]
async fn test_process_runner_virtual_pwd() {
    enable_virtual_commands();
    let mut runner = ProcessRunner::new("pwd", RunOptions::default());
    let result = runner.run().await.unwrap();
    assert!(result.is_success());
    assert!(!result.stdout.is_empty());
}
