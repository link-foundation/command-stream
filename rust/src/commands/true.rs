//! Virtual `true` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;

/// Execute the true command
///
/// Always returns success (exit code 0).
pub async fn r#true(_ctx: CommandContext) -> CommandResult {
    CommandResult::success_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_true() {
        let ctx = CommandContext::new(vec![]);
        let result = r#true(ctx).await;
        assert!(result.is_success());
        assert_eq!(result.code, 0);
    }
}
