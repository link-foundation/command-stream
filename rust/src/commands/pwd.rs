//! Virtual `pwd` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;
use std::env;

/// Execute the pwd command
///
/// Prints the current working directory.
pub async fn pwd(_ctx: CommandContext) -> CommandResult {
    match env::current_dir() {
        Ok(path) => CommandResult::success(format!("{}\n", path.display())),
        Err(e) => CommandResult::error(format!("pwd: {}\n", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pwd() {
        let ctx = CommandContext::new(vec![]);
        let result = pwd(ctx).await;
        assert!(result.is_success());
        assert!(!result.stdout.is_empty());
    }
}
