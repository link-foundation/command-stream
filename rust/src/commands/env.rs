//! Virtual `env` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;
use std::env;

/// Execute the env command
///
/// Displays environment variables.
pub async fn env(_ctx: CommandContext) -> CommandResult {
    let mut output = String::new();

    for (key, value) in env::vars() {
        output.push_str(&format!("{}={}\n", key, value));
    }

    CommandResult::success(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_env() {
        let ctx = CommandContext::new(vec![]);
        let result = env(ctx).await;

        assert!(result.is_success());
        // Should contain at least PATH or HOME
        assert!(result.stdout.contains("PATH=") || result.stdout.contains("HOME="));
    }
}
