//! Virtual `echo` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;

/// Execute the echo command
///
/// Outputs the arguments separated by spaces, followed by a newline.
pub async fn echo(ctx: CommandContext) -> CommandResult {
    let output = ctx.args.join(" ");
    CommandResult::success(format!("{}\n", output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_echo_simple() {
        let ctx = CommandContext::new(vec!["hello".to_string(), "world".to_string()]);
        let result = echo(ctx).await;
        assert!(result.is_success());
        assert_eq!(result.stdout, "hello world\n");
    }

    #[tokio::test]
    async fn test_echo_empty() {
        let ctx = CommandContext::new(vec![]);
        let result = echo(ctx).await;
        assert!(result.is_success());
        assert_eq!(result.stdout, "\n");
    }
}
