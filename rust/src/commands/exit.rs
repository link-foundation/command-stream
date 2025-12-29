//! Virtual `exit` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;

/// Execute the exit command
///
/// Exits with the specified code (default 0).
/// Note: This doesn't actually exit the process, it returns the exit code.
pub async fn exit(ctx: CommandContext) -> CommandResult {
    let code: i32 = ctx.args
        .first()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    CommandResult::error_with_code("", code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_exit_default() {
        let ctx = CommandContext::new(vec![]);
        let result = exit(ctx).await;
        assert_eq!(result.code, 0);
    }

    #[tokio::test]
    async fn test_exit_with_code() {
        let ctx = CommandContext::new(vec!["42".to_string()]);
        let result = exit(ctx).await;
        assert_eq!(result.code, 42);
    }
}
