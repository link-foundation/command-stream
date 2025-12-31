//! Virtual `test` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;
use std::fs;
use std::path::Path;

/// Execute the test command
///
/// Evaluates conditional expressions.
pub async fn test(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        return CommandResult::error_with_code("", 1);
    }

    let result = evaluate_expression(&ctx.args);

    if result {
        CommandResult::success_empty()
    } else {
        CommandResult::error_with_code("", 1)
    }
}

fn evaluate_expression(args: &[String]) -> bool {
    if args.is_empty() {
        return false;
    }

    // Handle unary operators
    if args.len() == 2 {
        let op = &args[0];
        let arg = &args[1];

        return match op.as_str() {
            "-e" => Path::new(arg).exists(),
            "-f" => Path::new(arg).is_file(),
            "-d" => Path::new(arg).is_dir(),
            "-r" => {
                // Check if readable (simplified)
                fs::metadata(arg).is_ok()
            }
            "-w" => {
                // Check if writable (simplified)
                fs::metadata(arg).map(|m| !m.permissions().readonly()).unwrap_or(false)
            }
            "-x" => {
                // Check if executable (simplified - Unix only)
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::metadata(arg)
                        .map(|m| m.permissions().mode() & 0o111 != 0)
                        .unwrap_or(false)
                }
                #[cfg(not(unix))]
                {
                    Path::new(arg).exists()
                }
            }
            "-s" => {
                // Check if file has size > 0
                fs::metadata(arg).map(|m| m.len() > 0).unwrap_or(false)
            }
            "-z" => arg.is_empty(),
            "-n" => !arg.is_empty(),
            "!" => !evaluate_expression(&args[1..]),
            _ => false,
        };
    }

    // Handle binary operators
    if args.len() == 3 {
        let left = &args[0];
        let op = &args[1];
        let right = &args[2];

        return match op.as_str() {
            "=" | "==" => left == right,
            "!=" => left != right,
            "-eq" => {
                let l: i64 = left.parse().unwrap_or(0);
                let r: i64 = right.parse().unwrap_or(0);
                l == r
            }
            "-ne" => {
                let l: i64 = left.parse().unwrap_or(0);
                let r: i64 = right.parse().unwrap_or(0);
                l != r
            }
            "-lt" => {
                let l: i64 = left.parse().unwrap_or(0);
                let r: i64 = right.parse().unwrap_or(0);
                l < r
            }
            "-le" => {
                let l: i64 = left.parse().unwrap_or(0);
                let r: i64 = right.parse().unwrap_or(0);
                l <= r
            }
            "-gt" => {
                let l: i64 = left.parse().unwrap_or(0);
                let r: i64 = right.parse().unwrap_or(0);
                l > r
            }
            "-ge" => {
                let l: i64 = left.parse().unwrap_or(0);
                let r: i64 = right.parse().unwrap_or(0);
                l >= r
            }
            _ => false,
        };
    }

    // Single argument: true if non-empty
    if args.len() == 1 {
        return !args[0].is_empty();
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_file_exists() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("test.txt");
        fs::write(&file, "test").unwrap();

        let ctx = CommandContext::new(vec![
            "-e".to_string(),
            file.to_string_lossy().to_string(),
        ]);
        let result = test(ctx).await;
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_file_not_exists() {
        let ctx = CommandContext::new(vec![
            "-e".to_string(),
            "/nonexistent/file/12345".to_string(),
        ]);
        let result = test(ctx).await;
        assert!(!result.is_success());
    }

    #[tokio::test]
    async fn test_string_equality() {
        let ctx = CommandContext::new(vec![
            "hello".to_string(),
            "=".to_string(),
            "hello".to_string(),
        ]);
        let result = test(ctx).await;
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_string_inequality() {
        let ctx = CommandContext::new(vec![
            "hello".to_string(),
            "!=".to_string(),
            "world".to_string(),
        ]);
        let result = test(ctx).await;
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_numeric_comparison() {
        let ctx = CommandContext::new(vec![
            "5".to_string(),
            "-gt".to_string(),
            "3".to_string(),
        ]);
        let result = test(ctx).await;
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_empty_string() {
        let ctx = CommandContext::new(vec![
            "-z".to_string(),
            "".to_string(),
        ]);
        let result = test(ctx).await;
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_non_empty_string() {
        let ctx = CommandContext::new(vec![
            "-n".to_string(),
            "hello".to_string(),
        ]);
        let result = test(ctx).await;
        assert!(result.is_success());
    }
}
