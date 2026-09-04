//! Virtual `dirname` command implementation

use crate::commands::CommandContext;
use crate::utils::{CommandResult, VirtualUtils};
use std::path::Path;

/// Execute the dirname command
///
/// Strips the last component from filenames.
pub async fn dirname(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        return VirtualUtils::missing_operand_error("dirname");
    }

    let path = &ctx.args[0];
    let parent = Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());

    // Handle empty parent (file in current directory)
    let result = if parent.is_empty() { "." } else { &parent };

    CommandResult::success(format!("{}\n", result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dirname_simple() {
        let ctx = CommandContext::new(vec!["/path/to/file.txt".to_string()]);
        let result = dirname(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "/path/to\n");
    }

    #[tokio::test]
    async fn test_dirname_just_file() {
        let ctx = CommandContext::new(vec!["file.txt".to_string()]);
        let result = dirname(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, ".\n");
    }

    #[tokio::test]
    async fn test_dirname_root() {
        let ctx = CommandContext::new(vec!["/file.txt".to_string()]);
        let result = dirname(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "/\n");
    }
}
