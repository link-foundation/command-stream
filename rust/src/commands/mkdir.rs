//! Virtual `mkdir` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult, VirtualUtils};
use std::fs;

/// Execute the mkdir command
///
/// Creates directories.
pub async fn mkdir(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        return VirtualUtils::missing_operand_error("mkdir");
    }

    // Check for -p flag
    let mut create_parents = false;
    let mut dirs = Vec::new();

    for arg in &ctx.args {
        if arg == "-p" {
            create_parents = true;
        } else if arg.starts_with('-') {
            // Skip other flags
        } else {
            dirs.push(arg.clone());
        }
    }

    if dirs.is_empty() {
        return VirtualUtils::missing_operand_error("mkdir");
    }

    let cwd = ctx.get_cwd();

    for dir in dirs {
        let resolved_path = VirtualUtils::resolve_path(&dir, Some(&cwd));

        trace_lazy("VirtualCommand", || {
            format!("mkdir: creating directory {:?}, parents: {}", resolved_path, create_parents)
        });

        let result = if create_parents {
            fs::create_dir_all(&resolved_path)
        } else {
            fs::create_dir(&resolved_path)
        };

        if let Err(e) = result {
            return CommandResult::error(format!("mkdir: cannot create directory '{}': {}\n", dir, e));
        }
    }

    CommandResult::success_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_mkdir_simple() {
        let temp = tempdir().unwrap();
        let new_dir = temp.path().join("new_directory");

        let ctx = CommandContext::new(vec![
            new_dir.to_string_lossy().to_string()
        ]);
        let result = mkdir(ctx).await;

        assert!(result.is_success());
        assert!(new_dir.exists());
    }

    #[tokio::test]
    async fn test_mkdir_with_parents() {
        let temp = tempdir().unwrap();
        let nested_dir = temp.path().join("a/b/c/d");

        let ctx = CommandContext::new(vec![
            "-p".to_string(),
            nested_dir.to_string_lossy().to_string(),
        ]);
        let result = mkdir(ctx).await;

        assert!(result.is_success());
        assert!(nested_dir.exists());
    }

    #[tokio::test]
    async fn test_mkdir_missing_operand() {
        let ctx = CommandContext::new(vec![]);
        let result = mkdir(ctx).await;

        assert!(!result.is_success());
        assert!(result.stderr.contains("missing operand"));
    }
}
