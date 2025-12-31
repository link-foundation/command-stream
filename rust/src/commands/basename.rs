//! Virtual `basename` command implementation

use crate::commands::CommandContext;
use crate::utils::{CommandResult, VirtualUtils};
use std::path::Path;

/// Execute the basename command
///
/// Strips directory and suffix from filenames.
pub async fn basename(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        return VirtualUtils::missing_operand_error("basename");
    }

    let path = &ctx.args[0];
    let suffix = ctx.args.get(1);

    let base = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let result = if let Some(suf) = suffix {
        if base.ends_with(suf.as_str()) {
            base[..base.len() - suf.len()].to_string()
        } else {
            base
        }
    } else {
        base
    };

    CommandResult::success(format!("{}\n", result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_basename_simple() {
        let ctx = CommandContext::new(vec!["/path/to/file.txt".to_string()]);
        let result = basename(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "file.txt\n");
    }

    #[tokio::test]
    async fn test_basename_with_suffix() {
        let ctx = CommandContext::new(vec![
            "/path/to/file.txt".to_string(),
            ".txt".to_string(),
        ]);
        let result = basename(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "file\n");
    }

    #[tokio::test]
    async fn test_basename_no_path() {
        let ctx = CommandContext::new(vec!["file.txt".to_string()]);
        let result = basename(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "file.txt\n");
    }
}
