//! Virtual `echo` command implementation

use crate::commands::CommandContext;
use crate::utils::CommandResult;

/// Execute the echo command
///
/// Outputs the arguments separated by spaces, followed by a newline.
/// Supports -n (no newline), -e (interpret escape sequences), and -E (no escape sequences)
pub async fn echo(ctx: CommandContext) -> CommandResult {
    let mut no_newline = false;
    let mut interpret_escapes = false;
    let mut args = ctx.args.iter().peekable();

    // Parse flags
    while let Some(arg) = args.peek() {
        if arg.starts_with('-') && arg.len() > 1 && arg.chars().skip(1).all(|c| c == 'n' || c == 'e' || c == 'E') {
            let arg = args.next().unwrap();
            for c in arg.chars().skip(1) {
                match c {
                    'n' => no_newline = true,
                    'e' => interpret_escapes = true,
                    'E' => interpret_escapes = false,
                    _ => {}
                }
            }
        } else {
            break;
        }
    }

    // Collect remaining args
    let remaining: Vec<_> = args.collect();
    let output = remaining.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" ");

    // Process escape sequences if -e flag is set
    let output = if interpret_escapes {
        output
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\r", "\r")
            .replace("\\\\", "\\")
    } else {
        output
    };

    if no_newline {
        CommandResult::success(output)
    } else {
        CommandResult::success(format!("{}\n", output))
    }
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
