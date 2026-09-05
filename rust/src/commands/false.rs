//! Virtual `false` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;

/// Execute the false command
///
/// Always returns failure (exit code 1).
pub async fn r#false(_ctx: CommandContext) -> CommandResult {
    CommandResult::error_with_code("", 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_false() {
        let ctx = CommandContext::new(vec![]);
        let result = r#false(ctx).await;
        assert!(!result.is_success());
        assert_eq!(result.code, 1);
    }
}
