//! Virtual `sleep` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult};
use tokio::time::{sleep as tokio_sleep, Duration};

/// Execute the sleep command
///
/// Pauses for the specified number of seconds.
pub async fn sleep(ctx: CommandContext) -> CommandResult {
    let seconds_str = ctx.args.first().map(|s| s.as_str()).unwrap_or("0");

    let seconds: f64 = match seconds_str.parse() {
        Ok(s) => s,
        Err(_) => {
            return CommandResult::error(format!(
                "sleep: invalid time interval '{}'\n",
                seconds_str
            ));
        }
    };

    if seconds < 0.0 {
        return CommandResult::error(format!(
            "sleep: invalid time interval '{}'\n",
            seconds_str
        ));
    }

    trace_lazy("VirtualCommand", || {
        format!("sleep: starting {} seconds", seconds)
    });

    let duration = Duration::from_secs_f64(seconds);

    // Check for cancellation during sleep
    tokio::select! {
        _ = tokio_sleep(duration) => {
            trace_lazy("VirtualCommand", || {
                format!("sleep: completed naturally after {} seconds", seconds)
            });
            CommandResult::success_empty()
        }
        _ = async {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;
                if ctx.is_cancelled() {
                    break;
                }
            }
        } => {
            trace_lazy("VirtualCommand", || {
                format!("sleep: cancelled after partial sleep")
            });
            CommandResult::error_with_code("", 130) // SIGINT exit code
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[tokio::test]
    async fn test_sleep_short() {
        let ctx = CommandContext::new(vec!["0.1".to_string()]);
        let start = Instant::now();
        let result = sleep(ctx).await;
        let elapsed = start.elapsed();

        assert!(result.is_success());
        assert!(elapsed >= Duration::from_millis(100));
        assert!(elapsed < Duration::from_millis(200));
    }

    #[tokio::test]
    async fn test_sleep_zero() {
        let ctx = CommandContext::new(vec!["0".to_string()]);
        let result = sleep(ctx).await;
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_sleep_invalid() {
        let ctx = CommandContext::new(vec!["invalid".to_string()]);
        let result = sleep(ctx).await;
        assert!(!result.is_success());
    }

    #[tokio::test]
    async fn test_sleep_negative() {
        let ctx = CommandContext::new(vec!["-1".to_string()]);
        let result = sleep(ctx).await;
        assert!(!result.is_success());
    }
}
