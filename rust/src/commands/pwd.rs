//! Virtual `pwd` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;

/// Execute the pwd command
///
/// Prints the current working directory.
pub async fn pwd(ctx: CommandContext) -> CommandResult {
    let path = ctx.get_cwd();
    CommandResult::success(format!("{}\n", path.display()))
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
