//! Virtual `seq` command implementation

use crate::commands::CommandContext;
use crate::utils::{CommandResult, VirtualUtils};

/// Execute the seq command
///
/// Prints a sequence of numbers.
pub async fn seq(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        return VirtualUtils::missing_operand_error("seq");
    }

    let (first, increment, last) = match ctx.args.len() {
        1 => {
            let last: f64 = match ctx.args[0].parse() {
                Ok(n) => n,
                Err(_) => {
                    return CommandResult::error(format!(
                        "seq: invalid floating point argument: '{}'\n",
                        ctx.args[0]
                    ));
                }
            };
            (1.0, 1.0, last)
        }
        2 => {
            let first: f64 = match ctx.args[0].parse() {
                Ok(n) => n,
                Err(_) => {
                    return CommandResult::error(format!(
                        "seq: invalid floating point argument: '{}'\n",
                        ctx.args[0]
                    ));
                }
            };
            let last: f64 = match ctx.args[1].parse() {
                Ok(n) => n,
                Err(_) => {
                    return CommandResult::error(format!(
                        "seq: invalid floating point argument: '{}'\n",
                        ctx.args[1]
                    ));
                }
            };
            (first, 1.0, last)
        }
        _ => {
            let first: f64 = match ctx.args[0].parse() {
                Ok(n) => n,
                Err(_) => {
                    return CommandResult::error(format!(
                        "seq: invalid floating point argument: '{}'\n",
                        ctx.args[0]
                    ));
                }
            };
            let increment: f64 = match ctx.args[1].parse() {
                Ok(n) => n,
                Err(_) => {
                    return CommandResult::error(format!(
                        "seq: invalid floating point argument: '{}'\n",
                        ctx.args[1]
                    ));
                }
            };
            let last: f64 = match ctx.args[2].parse() {
                Ok(n) => n,
                Err(_) => {
                    return CommandResult::error(format!(
                        "seq: invalid floating point argument: '{}'\n",
                        ctx.args[2]
                    ));
                }
            };
            (first, increment, last)
        }
    };

    if increment == 0.0 {
        return CommandResult::error("seq: zero increment\n");
    }

    let mut output = String::new();
    let mut current = first;

    if increment > 0.0 {
        while current <= last {
            if ctx.is_cancelled() {
                return CommandResult::error_with_code("", 130);
            }

            // Format as integer if possible
            if current.fract() == 0.0 {
                output.push_str(&format!("{}\n", current as i64));
            } else {
                output.push_str(&format!("{}\n", current));
            }
            current += increment;
        }
    } else {
        while current >= last {
            if ctx.is_cancelled() {
                return CommandResult::error_with_code("", 130);
            }

            if current.fract() == 0.0 {
                output.push_str(&format!("{}\n", current as i64));
            } else {
                output.push_str(&format!("{}\n", current));
            }
            current += increment;
        }
    }

    CommandResult::success(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_seq_single_arg() {
        let ctx = CommandContext::new(vec!["5".to_string()]);
        let result = seq(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "1\n2\n3\n4\n5\n");
    }

    #[tokio::test]
    async fn test_seq_two_args() {
        let ctx = CommandContext::new(vec!["3".to_string(), "7".to_string()]);
        let result = seq(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "3\n4\n5\n6\n7\n");
    }

    #[tokio::test]
    async fn test_seq_three_args() {
        let ctx = CommandContext::new(vec![
            "2".to_string(),
            "2".to_string(),
            "8".to_string(),
        ]);
        let result = seq(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "2\n4\n6\n8\n");
    }

    #[tokio::test]
    async fn test_seq_descending() {
        let ctx = CommandContext::new(vec![
            "5".to_string(),
            "-1".to_string(),
            "1".to_string(),
        ]);
        let result = seq(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "5\n4\n3\n2\n1\n");
    }

    #[tokio::test]
    async fn test_seq_zero_increment() {
        let ctx = CommandContext::new(vec![
            "1".to_string(),
            "0".to_string(),
            "5".to_string(),
        ]);
        let result = seq(ctx).await;

        assert!(!result.is_success());
        assert!(result.stderr.contains("zero increment"));
    }
}
