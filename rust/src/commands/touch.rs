//! Virtual `touch` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult, VirtualUtils};
use std::fs::{self, OpenOptions};
use std::time::SystemTime;

/// Execute the touch command
///
/// Updates file timestamps or creates empty files.
pub async fn touch(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        return VirtualUtils::missing_operand_error("touch");
    }

    let cwd = ctx.get_cwd();

    for file in &ctx.args {
        if file.starts_with('-') {
            // Skip flags for now
            continue;
        }

        let resolved_path = VirtualUtils::resolve_path(file, Some(&cwd));

        trace_lazy("VirtualCommand", || {
            format!("touch: touching {:?}", resolved_path)
        });

        if resolved_path.exists() {
            // Update modification time
            let now = SystemTime::now();
            if let Err(e) = filetime::set_file_mtime(&resolved_path, filetime::FileTime::from_system_time(now)) {
                // Fallback: try to just open and close the file
                if let Err(e2) = OpenOptions::new().write(true).open(&resolved_path) {
                    return CommandResult::error(format!("touch: cannot touch '{}': {}\n", file, e2));
                }
            }
        } else {
            // Create the file
            if let Some(parent) = resolved_path.parent() {
                if !parent.exists() {
                    if let Err(e) = fs::create_dir_all(parent) {
                        return CommandResult::error(format!("touch: cannot touch '{}': {}\n", file, e));
                    }
                }
            }

            if let Err(e) = fs::File::create(&resolved_path) {
                return CommandResult::error(format!("touch: cannot touch '{}': {}\n", file, e));
            }
        }
    }

    CommandResult::success_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_touch_new_file() {
        let temp = tempdir().unwrap();
        let new_file = temp.path().join("new_file.txt");

        let ctx = CommandContext::new(vec![
            new_file.to_string_lossy().to_string()
        ]);
        let result = touch(ctx).await;

        assert!(result.is_success());
        assert!(new_file.exists());
    }

    #[tokio::test]
    async fn test_touch_existing_file() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("existing.txt");
        fs::write(&file, "test").unwrap();

        let ctx = CommandContext::new(vec![
            file.to_string_lossy().to_string()
        ]);
        let result = touch(ctx).await;

        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_touch_missing_operand() {
        let ctx = CommandContext::new(vec![]);
        let result = touch(ctx).await;

        assert!(!result.is_success());
        assert!(result.stderr.contains("missing operand"));
    }
}
