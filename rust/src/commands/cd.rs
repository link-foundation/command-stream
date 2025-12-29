//! Virtual `cd` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace, CommandResult};
use std::env;
use std::path::PathBuf;

/// Execute the cd command
///
/// Changes the current working directory.
pub async fn cd(ctx: CommandContext) -> CommandResult {
    let target = if ctx.args.is_empty() {
        // No argument - go to home directory
        env::var("HOME")
            .or_else(|_| env::var("USERPROFILE"))
            .unwrap_or_else(|_| "/".to_string())
    } else {
        ctx.args[0].clone()
    };

    trace("VirtualCommand", &format!("cd: changing directory to {:?}", target));

    let path = PathBuf::from(&target);

    match env::set_current_dir(&path) {
        Ok(()) => {
            let new_dir = env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default();
            trace("VirtualCommand", &format!("cd: success, new dir: {}", new_dir));
            // cd command should not output anything on success
            CommandResult::success_empty()
        }
        Err(e) => {
            trace("VirtualCommand", &format!("cd: failed: {}", e));
            CommandResult::error(format!("cd: {}\n", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_cd_to_temp() {
        let temp = tempdir().unwrap();
        let temp_path = temp.path().to_string_lossy().to_string();
        let original_dir = env::current_dir().unwrap();

        let ctx = CommandContext::new(vec![temp_path.clone()]);
        let result = cd(ctx).await;
        assert!(result.is_success());
        assert_eq!(result.stdout, "");

        // Restore original directory
        env::set_current_dir(original_dir).unwrap();
    }

    #[tokio::test]
    async fn test_cd_to_nonexistent() {
        let ctx = CommandContext::new(vec!["/nonexistent/path/12345".to_string()]);
        let result = cd(ctx).await;
        assert!(!result.is_success());
    }
}
