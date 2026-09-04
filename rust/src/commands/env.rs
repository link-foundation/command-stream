//! Virtual `env` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;
use std::collections::HashMap;

/// Execute the env command
///
/// Displays environment variables.
pub async fn env(ctx: CommandContext) -> CommandResult {
    let mut output = String::new();

    let mut env_vars: HashMap<_, _> = std::env::vars().collect();
    if let Some(overrides) = ctx.env {
        env_vars.extend(overrides);
    }
    for (key, value) in env_vars {
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
