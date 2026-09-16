//! Virtual `yes` command implementation

use crate::commands::{CommandContext, StreamChunk};
use crate::utils::{trace_lazy, CommandResult};
use tokio::time::Duration;

/// Execute the yes command
///
/// Outputs a string repeatedly until cancelled.
pub async fn yes(ctx: CommandContext) -> CommandResult {
    let output_str = if ctx.args.is_empty() {
        "y".to_string()
    } else {
        ctx.args.join(" ")
    };

    let line = format!("{}\n", output_str);

    trace_lazy("VirtualCommand", || {
        format!("yes: starting with output '{}'", output_str)
    });

    // If we have a streaming output channel, use it
    if let Some(ref tx) = ctx.output_tx {
        loop {
            if ctx.is_cancelled() {
                trace_lazy("VirtualCommand", || "yes: cancelled".to_string());
                return CommandResult::error_with_code("", 130);
            }

            if tx.send(StreamChunk::Stdout(line.clone())).await.is_err() {
                // Channel closed
                break;
            }

            // Small delay to prevent overwhelming
            tokio::time::sleep(Duration::from_micros(100)).await;
        }
    } else {
        // Without streaming, just output a few lines and return
        // This is a safety measure to prevent infinite output
        let mut output = String::new();
        let max_iterations = 1000;

        for _ in 0..max_iterations {
            if ctx.is_cancelled() {
                trace_lazy("VirtualCommand", || "yes: cancelled".to_string());
                return CommandResult::error_with_code("", 130);
            }
            output.push_str(&line);
        }

        return CommandResult::success(output);
    }

    CommandResult::error_with_code("", 130)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn test_yes_with_cancellation() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_clone = cancelled.clone();

        let mut ctx = CommandContext::new(vec![]);
        ctx.is_cancelled = Some(Box::new(move || cancelled_clone.load(Ordering::SeqCst)));

        // Cancel after a short delay
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            cancelled.store(true, Ordering::SeqCst);
        });

        let result = yes(ctx).await;

        // Should have produced some output before being cancelled
        assert!(!result.stdout.is_empty() || result.code == 130);
    }

    #[tokio::test]
    async fn test_yes_custom_string() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_clone = cancelled.clone();

        let mut ctx = CommandContext::new(vec!["hello".to_string()]);
        ctx.is_cancelled = Some(Box::new(move || cancelled_clone.load(Ordering::SeqCst)));

        // Cancel immediately
        cancelled.store(true, Ordering::SeqCst);

        let result = yes(ctx).await;
        assert_eq!(result.code, 130);
    }
}
