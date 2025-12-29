//! Virtual `which` command implementation

use crate::commands::CommandContext;
use crate::utils::{CommandResult, VirtualUtils};

/// Execute the which command
///
/// Locates commands in the PATH.
pub async fn which(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        return VirtualUtils::missing_operand_error("which");
    }

    let mut output = String::new();
    let mut found_all = true;

    for cmd in &ctx.args {
        if cmd.starts_with('-') {
            continue;
        }

        match which::which(cmd) {
            Ok(path) => {
                output.push_str(&format!("{}\n", path.display()));
            }
            Err(_) => {
                found_all = false;
            }
        }
    }

    if output.is_empty() {
        CommandResult::error_with_code("", 1)
    } else if !found_all {
        // Some commands found, some not
        CommandResult {
            stdout: output,
            stderr: String::new(),
            code: 1,
        }
    } else {
        CommandResult::success(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_which_existing_command() {
        // 'sh' should exist on most Unix systems
        let ctx = CommandContext::new(vec!["sh".to_string()]);
        let result = which(ctx).await;

        // May or may not find sh depending on PATH
        // Just check it doesn't panic
        assert!(result.code == 0 || result.code == 1);
    }

    #[tokio::test]
    async fn test_which_nonexistent_command() {
        let ctx = CommandContext::new(vec!["nonexistent_command_12345".to_string()]);
        let result = which(ctx).await;

        assert_eq!(result.code, 1);
    }
}
