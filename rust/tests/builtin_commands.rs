//! Integration tests for built-in virtual commands
//!
//! These tests mirror the JavaScript tests in js/tests/builtin-commands.test.mjs

use command_stream::commands::{
    basename, cat, cd, cp, dirname, echo, env, exit, ls, mkdir, mv, pwd, rm, seq, sleep, test,
    touch, which, yes, CommandContext,
};
use command_stream::utils::CommandResult;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

/// Helper to create a command context with args
fn ctx(args: Vec<&str>) -> CommandContext {
    CommandContext {
        args: args.into_iter().map(String::from).collect(),
        stdin: None,
        cwd: None,
        env: None,
        output_tx: None,
        is_cancelled: None,
    }
}

/// Helper to create a command context with args and cwd
fn ctx_with_cwd(args: Vec<&str>, cwd: PathBuf) -> CommandContext {
    CommandContext {
        args: args.into_iter().map(String::from).collect(),
        stdin: None,
        cwd: Some(cwd),
        env: None,
        output_tx: None,
        is_cancelled: None,
    }
}

/// Helper to create a command context with stdin
fn ctx_with_stdin(args: Vec<&str>, stdin: &str) -> CommandContext {
    CommandContext {
        args: args.into_iter().map(String::from).collect(),
        stdin: Some(stdin.to_string()),
        cwd: None,
        env: None,
        output_tx: None,
        is_cancelled: None,
    }
}

// ============================================================================
// Echo Command Tests
// ============================================================================

#[tokio::test]
async fn test_echo_basic() {
    let result = echo(ctx(vec!["Hello", "World"])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout, "Hello World\n");
}

#[tokio::test]
async fn test_echo_with_n_flag() {
    let result = echo(ctx(vec!["-n", "Hello"])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout, "Hello");
}

#[tokio::test]
async fn test_echo_empty() {
    let result = echo(ctx(vec![])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout, "\n");
}

#[tokio::test]
async fn test_echo_with_e_flag() {
    let result = echo(ctx(vec!["-e", "Hello\\nWorld"])).await;
    assert!(result.is_success());
    assert!(result.stdout.contains("\n"));
}

// ============================================================================
// Pwd Command Tests
// ============================================================================

#[tokio::test]
async fn test_pwd_returns_current_directory() {
    let result = pwd(ctx(vec![])).await;
    assert!(result.is_success());
    assert!(!result.stdout.is_empty());
}

// ============================================================================
// True/False Command Tests
// ============================================================================

#[tokio::test]
async fn test_true_command() {
    let result = command_stream::commands::r#true(ctx(vec![])).await;
    assert!(result.is_success());
    assert_eq!(result.code, 0);
}

#[tokio::test]
async fn test_false_command() {
    let result = command_stream::commands::r#false(ctx(vec![])).await;
    assert!(!result.is_success());
    assert_eq!(result.code, 1);
}

// ============================================================================
// Cat Command Tests
// ============================================================================

#[tokio::test]
async fn test_cat_read_file() {
    let dir = TempDir::new().unwrap();
    let file_path = dir.path().join("test.txt");
    fs::write(&file_path, "Hello World\nLine 2\n").unwrap();

    let result = cat(ctx(vec![file_path.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout, "Hello World\nLine 2\n");
}

#[tokio::test]
async fn test_cat_from_stdin() {
    let result = cat(ctx_with_stdin(vec![], "stdin input")).await;
    assert!(result.is_success());
    assert_eq!(result.stdout, "stdin input");
}

#[tokio::test]
async fn test_cat_nonexistent_file() {
    let result = cat(ctx(vec!["nonexistent.txt"])).await;
    assert!(!result.is_success());
    assert!(result.stderr.contains("No such file or directory"));
}

// ============================================================================
// Ls Command Tests
// ============================================================================

#[tokio::test]
async fn test_ls_list_directory() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("file1.txt"), "content").unwrap();
    fs::write(dir.path().join("file2.txt"), "content").unwrap();
    fs::create_dir(dir.path().join("subdir")).unwrap();

    let result = ls(ctx(vec![dir.path().to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(result.stdout.contains("file1.txt"));
    assert!(result.stdout.contains("file2.txt"));
    assert!(result.stdout.contains("subdir"));
}

#[tokio::test]
async fn test_ls_with_a_flag() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join(".hidden"), "content").unwrap();
    fs::write(dir.path().join("visible.txt"), "content").unwrap();

    let result = ls(ctx(vec!["-a", dir.path().to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(result.stdout.contains(".hidden"));
    assert!(result.stdout.contains("visible.txt"));
}

#[tokio::test]
async fn test_ls_with_l_flag() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("test.txt"), "content").unwrap();

    let result = ls(ctx(vec!["-l", dir.path().to_str().unwrap()])).await;
    assert!(result.is_success());
    // Long format should include permissions
    assert!(result.stdout.contains("-") || result.stdout.contains("r"));
    assert!(result.stdout.contains("test.txt"));
}

// ============================================================================
// Mkdir Command Tests
// ============================================================================

#[tokio::test]
async fn test_mkdir_create_directory() {
    let dir = TempDir::new().unwrap();
    let new_dir = dir.path().join("newdir");

    let result = mkdir(ctx(vec![new_dir.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(new_dir.exists());
}

#[tokio::test]
async fn test_mkdir_with_p_flag() {
    let dir = TempDir::new().unwrap();
    let nested_dir = dir.path().join("parent").join("child");

    let result = mkdir(ctx(vec!["-p", nested_dir.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(nested_dir.exists());
}

// ============================================================================
// Touch Command Tests
// ============================================================================

#[tokio::test]
async fn test_touch_create_file() {
    let dir = TempDir::new().unwrap();
    let file_path = dir.path().join("touched.txt");

    let result = touch(ctx(vec![file_path.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(file_path.exists());
}

#[tokio::test]
async fn test_touch_update_timestamp() {
    let dir = TempDir::new().unwrap();
    let file_path = dir.path().join("existing.txt");
    fs::write(&file_path, "content").unwrap();
    let old_mtime = fs::metadata(&file_path).unwrap().modified().unwrap();

    // Wait a bit to ensure timestamp difference
    std::thread::sleep(std::time::Duration::from_millis(10));

    let result = touch(ctx(vec![file_path.to_str().unwrap()])).await;
    assert!(result.is_success());

    let new_mtime = fs::metadata(&file_path).unwrap().modified().unwrap();
    assert!(new_mtime > old_mtime);
}

// ============================================================================
// Rm Command Tests
// ============================================================================

#[tokio::test]
async fn test_rm_remove_file() {
    let dir = TempDir::new().unwrap();
    let file_path = dir.path().join("to-remove.txt");
    fs::write(&file_path, "content").unwrap();

    let result = rm(ctx(vec![file_path.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(!file_path.exists());
}

#[tokio::test]
async fn test_rm_fail_on_directory() {
    let dir = TempDir::new().unwrap();
    let sub_dir = dir.path().join("to-remove-dir");
    fs::create_dir(&sub_dir).unwrap();

    let result = rm(ctx(vec![sub_dir.to_str().unwrap()])).await;
    assert!(!result.is_success());
    assert!(result.stderr.contains("Is a directory"));
    assert!(sub_dir.exists());
}

#[tokio::test]
async fn test_rm_recursive() {
    let dir = TempDir::new().unwrap();
    let sub_dir = dir.path().join("to-remove-recursive");
    fs::create_dir(&sub_dir).unwrap();
    fs::write(sub_dir.join("file.txt"), "content").unwrap();

    let result = rm(ctx(vec!["-r", sub_dir.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(!sub_dir.exists());
}

#[tokio::test]
async fn test_rm_force() {
    let result = rm(ctx(vec!["-f", "nonexistent.txt"])).await;
    assert!(result.is_success());
}

// ============================================================================
// Cp Command Tests
// ============================================================================

#[tokio::test]
async fn test_cp_copy_file() {
    let dir = TempDir::new().unwrap();
    let source = dir.path().join("source.txt");
    let dest = dir.path().join("dest.txt");
    fs::write(&source, "test content").unwrap();

    let result = cp(ctx(vec![source.to_str().unwrap(), dest.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(dest.exists());
    assert_eq!(fs::read_to_string(&dest).unwrap(), "test content");
}

#[tokio::test]
async fn test_cp_recursive() {
    let dir = TempDir::new().unwrap();
    let source_dir = dir.path().join("source-dir");
    let dest_dir = dir.path().join("dest-dir");
    fs::create_dir(&source_dir).unwrap();
    fs::write(source_dir.join("file.txt"), "content").unwrap();

    let result = cp(ctx(vec![
        "-r",
        source_dir.to_str().unwrap(),
        dest_dir.to_str().unwrap(),
    ]))
    .await;
    assert!(result.is_success());
    assert!(dest_dir.exists());
    assert!(dest_dir.join("file.txt").exists());
}

// ============================================================================
// Mv Command Tests
// ============================================================================

#[tokio::test]
async fn test_mv_rename_file() {
    let dir = TempDir::new().unwrap();
    let source = dir.path().join("source.txt");
    let dest = dir.path().join("dest.txt");
    fs::write(&source, "test content").unwrap();

    let result = mv(ctx(vec![source.to_str().unwrap(), dest.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(!source.exists());
    assert!(dest.exists());
    assert_eq!(fs::read_to_string(&dest).unwrap(), "test content");
}

#[tokio::test]
async fn test_mv_to_directory() {
    let dir = TempDir::new().unwrap();
    let source = dir.path().join("source.txt");
    let dest_dir = dir.path().join("dest-dir");
    fs::write(&source, "test content").unwrap();
    fs::create_dir(&dest_dir).unwrap();

    let result = mv(ctx(vec![source.to_str().unwrap(), dest_dir.to_str().unwrap()])).await;
    assert!(result.is_success());
    assert!(!source.exists());
    assert!(dest_dir.join("source.txt").exists());
}

// ============================================================================
// Basename/Dirname Command Tests
// ============================================================================

#[tokio::test]
async fn test_basename() {
    let result = basename(ctx(vec!["/path/to/file.txt"])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout.trim(), "file.txt");
}

#[tokio::test]
async fn test_basename_with_suffix() {
    let result = basename(ctx(vec!["/path/to/file.txt", ".txt"])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout.trim(), "file");
}

#[tokio::test]
async fn test_dirname() {
    let result = dirname(ctx(vec!["/path/to/file.txt"])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout.trim(), "/path/to");
}

// ============================================================================
// Which Command Tests
// ============================================================================

#[tokio::test]
async fn test_which_builtin() {
    let result = which(ctx(vec!["echo"])).await;
    assert!(result.is_success());
    assert!(result.stdout.contains("shell builtin"));
}

// ============================================================================
// Exit Command Tests
// ============================================================================

#[tokio::test]
async fn test_exit_default() {
    let result = exit(ctx(vec![])).await;
    assert!(result.is_success());
    assert_eq!(result.code, 0);
}

#[tokio::test]
async fn test_exit_with_code() {
    let result = exit(ctx(vec!["42"])).await;
    assert!(!result.is_success());
    assert_eq!(result.code, 42);
}

// ============================================================================
// Sleep Command Tests
// ============================================================================

#[tokio::test]
async fn test_sleep() {
    let start = std::time::Instant::now();
    let result = sleep(ctx(vec!["0.1"])).await;
    let elapsed = start.elapsed();

    assert!(result.is_success());
    assert!(elapsed.as_millis() >= 90);
    assert!(elapsed.as_millis() < 200);
}

// ============================================================================
// Seq Command Tests
// ============================================================================

#[tokio::test]
async fn test_seq_simple() {
    let result = seq(ctx(vec!["5"])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout, "1\n2\n3\n4\n5\n");
}

#[tokio::test]
async fn test_seq_range() {
    let result = seq(ctx(vec!["2", "5"])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout, "2\n3\n4\n5\n");
}

#[tokio::test]
async fn test_seq_with_increment() {
    let result = seq(ctx(vec!["1", "2", "5"])).await;
    assert!(result.is_success());
    assert_eq!(result.stdout, "1\n3\n5\n");
}

// ============================================================================
// Yes Command Tests
// ============================================================================

#[tokio::test]
async fn test_yes_with_cancel() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    // Create a cancellation flag
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancelled_clone = cancelled.clone();

    // Cancel after a short delay
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        cancelled_clone.store(true, Ordering::SeqCst);
    });

    let ctx = CommandContext {
        args: vec![],
        stdin: None,
        cwd: None,
        env: None,
        output_tx: None,
        is_cancelled: Some(Box::new(move || cancelled.load(Ordering::SeqCst))),
    };

    let result = yes(ctx).await;
    // Yes command should have produced some output before being cancelled
    assert!(result.stdout.contains("y") || result.is_success());
}

// ============================================================================
// Test Command Tests
// ============================================================================

#[tokio::test]
async fn test_test_file_exists() {
    let dir = TempDir::new().unwrap();
    let file_path = dir.path().join("test.txt");
    fs::write(&file_path, "content").unwrap();

    let result = test(ctx(vec!["-e", file_path.to_str().unwrap()])).await;
    assert!(result.is_success());
}

#[tokio::test]
async fn test_test_file_not_exists() {
    let result = test(ctx(vec!["-e", "nonexistent.txt"])).await;
    assert!(!result.is_success());
}

#[tokio::test]
async fn test_test_is_file() {
    let dir = TempDir::new().unwrap();
    let file_path = dir.path().join("test.txt");
    fs::write(&file_path, "content").unwrap();

    let result = test(ctx(vec!["-f", file_path.to_str().unwrap()])).await;
    assert!(result.is_success());
}

#[tokio::test]
async fn test_test_is_directory() {
    let dir = TempDir::new().unwrap();

    let result = test(ctx(vec!["-d", dir.path().to_str().unwrap()])).await;
    assert!(result.is_success());
}

#[tokio::test]
async fn test_test_string_not_empty() {
    let result = test(ctx(vec!["-n", "hello"])).await;
    assert!(result.is_success());
}

#[tokio::test]
async fn test_test_string_empty() {
    let result = test(ctx(vec!["-z", ""])).await;
    assert!(result.is_success());
}

#[tokio::test]
async fn test_test_string_equals() {
    let result = test(ctx(vec!["hello", "=", "hello"])).await;
    assert!(result.is_success());
}

#[tokio::test]
async fn test_test_string_not_equals() {
    let result = test(ctx(vec!["hello", "!=", "world"])).await;
    assert!(result.is_success());
}

// ============================================================================
// Env Command Tests
// ============================================================================

#[tokio::test]
async fn test_env_list() {
    let result = env(ctx(vec![])).await;
    assert!(result.is_success());
    // Should contain some environment variables
    assert!(!result.stdout.is_empty());
}
