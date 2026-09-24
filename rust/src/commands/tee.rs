//! Virtual `tee` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult, VirtualUtils};
use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};

/// Translate a file system error into the message GNU tee prints.
fn file_error_message(file: &str, error: &std::io::Error) -> String {
    match error.kind() {
        ErrorKind::NotFound => format!("tee: {}: No such file or directory\n", file),
        ErrorKind::IsADirectory => format!("tee: {}: Is a directory\n", file),
        ErrorKind::PermissionDenied => format!("tee: {}: Permission denied\n", file),
        _ if error.to_string().contains("directory") => {
            format!("tee: {}: Is a directory\n", file)
        }
        _ => format!("tee: {}: {}\n", file, error),
    }
}

/// Parsed `tee` operands
#[derive(Debug, Default, PartialEq)]
struct ParsedArgs {
    append: bool,
    ignore_interrupts: bool,
    files: Vec<String>,
    error: Option<String>,
}

/// Parse tee operands.
///
/// Supports `-a`/`--append`, `-i`/`--ignore-interrupts`, clustered short
/// options such as `-ai`, and `--` to end option parsing. Everything else is an
/// operand, including a bare `-`, which GNU tee treats as a file named `-`.
fn parse_args(args: &[String]) -> ParsedArgs {
    let mut parsed = ParsedArgs::default();
    let mut options_ended = false;

    for arg in args {
        if options_ended || arg == "-" || !arg.starts_with('-') {
            parsed.files.push(arg.clone());
            continue;
        }

        if arg == "--" {
            options_ended = true;
            continue;
        }

        if arg == "--append" {
            parsed.append = true;
            continue;
        }

        if arg == "--ignore-interrupts" {
            parsed.ignore_interrupts = true;
            continue;
        }

        if arg.starts_with("--") {
            parsed.error = Some(format!("tee: unrecognized option '{}'\n", arg));
            return parsed;
        }

        for flag in arg.chars().skip(1) {
            match flag {
                'a' => parsed.append = true,
                'i' => parsed.ignore_interrupts = true,
                _ => {
                    parsed.error = Some(format!("tee: invalid option -- '{}'\n", flag));
                    return parsed;
                }
            }
        }
    }

    parsed
}

/// Execute the tee command
///
/// Reads stdin, copies it to stdout so the pipeline keeps flowing, and writes
/// the same bytes to every file operand. File operands are truncated unless
/// `-a` is given. A file that cannot be written reports an error and sets the
/// exit code to 1, but the remaining files and stdout are still written, which
/// is what GNU tee does.
pub async fn tee(ctx: CommandContext) -> CommandResult {
    let parsed = parse_args(&ctx.args);

    if let Some(error) = parsed.error {
        trace_lazy("VirtualCommand", || format!("tee: {}", error.trim_end()));
        return VirtualUtils::error(error);
    }

    let input = ctx.stdin.clone().unwrap_or_default();

    trace_lazy("VirtualCommand", || {
        format!(
            "tee: starting | append={}, ignore_interrupts={}, files={:?}, stdin_length={}",
            parsed.append,
            parsed.ignore_interrupts,
            parsed.files,
            input.len()
        )
    });

    let cwd = ctx.get_cwd();
    let mut stderr = String::new();
    let mut code = 0;

    for file in &parsed.files {
        if !parsed.ignore_interrupts && ctx.is_cancelled() {
            trace_lazy("VirtualCommand", || {
                "tee: cancelled while writing files".to_string()
            });
            // SIGINT exit code, with the input still forwarded to stdout.
            return CommandResult::new(input, stderr, 130);
        }

        let resolved_path = VirtualUtils::resolve_path(file, Some(&cwd));
        trace_lazy("VirtualCommand", || {
            format!(
                "tee: writing file | file={:?}, append={}, bytes={}",
                resolved_path,
                parsed.append,
                input.len()
            )
        });

        let write_result = OpenOptions::new()
            .write(true)
            .create(true)
            .append(parsed.append)
            .truncate(!parsed.append)
            .open(&resolved_path)
            .and_then(|mut handle| handle.write_all(input.as_bytes()));

        if let Err(write_error) = write_result {
            // GNU tee keeps copying to the remaining files and to stdout after
            // a failed target, and exits with 1 at the end.
            stderr.push_str(&file_error_message(file, &write_error));
            code = 1;
        }
    }

    trace_lazy("VirtualCommand", || {
        format!(
            "tee: finished | files_written={}, code={}, stdout_bytes={}",
            parsed.files.len(),
            code,
            input.len()
        )
    });

    CommandResult::new(input, stderr, code)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_parse_args_defaults() {
        let parsed = parse_args(&args(&["a.txt", "b.txt"]));
        assert!(!parsed.append);
        assert!(!parsed.ignore_interrupts);
        assert_eq!(parsed.files, vec!["a.txt", "b.txt"]);
        assert!(parsed.error.is_none());
    }

    #[test]
    fn test_parse_args_short_and_long_flags() {
        let parsed = parse_args(&args(&["-a", "--ignore-interrupts", "out.txt"]));
        assert!(parsed.append);
        assert!(parsed.ignore_interrupts);
        assert_eq!(parsed.files, vec!["out.txt"]);
    }

    #[test]
    fn test_parse_args_clustered_flags() {
        let parsed = parse_args(&args(&["-ai", "out.txt"]));
        assert!(parsed.append);
        assert!(parsed.ignore_interrupts);
        assert_eq!(parsed.files, vec!["out.txt"]);
    }

    #[test]
    fn test_parse_args_double_dash_ends_options() {
        let parsed = parse_args(&args(&["--", "-a"]));
        assert!(!parsed.append);
        assert_eq!(parsed.files, vec!["-a"]);
    }

    #[test]
    fn test_parse_args_bare_dash_is_a_file() {
        // GNU tee treats a lone `-` as a file named `-`, not as stdout.
        let parsed = parse_args(&args(&["-"]));
        assert_eq!(parsed.files, vec!["-"]);
        assert!(parsed.error.is_none());
    }

    #[test]
    fn test_parse_args_unrecognized_long_option() {
        let parsed = parse_args(&args(&["--unknown-option", "out.txt"]));
        assert_eq!(
            parsed.error,
            Some("tee: unrecognized option \'--unknown-option\'\n".to_string())
        );
    }

    #[test]
    fn test_parse_args_invalid_short_option() {
        let parsed = parse_args(&args(&["-z", "out.txt"]));
        assert_eq!(
            parsed.error,
            Some("tee: invalid option -- \'z\'\n".to_string())
        );
    }

    #[test]
    fn test_file_error_messages() {
        let not_found = std::io::Error::new(ErrorKind::NotFound, "nope");
        assert_eq!(
            file_error_message("missing.txt", &not_found),
            "tee: missing.txt: No such file or directory\n"
        );

        let denied = std::io::Error::new(ErrorKind::PermissionDenied, "nope");
        assert_eq!(
            file_error_message("locked.txt", &denied),
            "tee: locked.txt: Permission denied\n"
        );

        let is_dir = std::io::Error::new(ErrorKind::IsADirectory, "nope");
        assert_eq!(
            file_error_message("adir", &is_dir),
            "tee: adir: Is a directory\n"
        );
    }

    #[tokio::test]
    async fn test_tee_cancellation_returns_sigint_code() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("out.txt");

        let mut ctx = CommandContext::new(vec![file.to_string_lossy().to_string()]);
        ctx.stdin = Some("payload".to_string());
        ctx.is_cancelled = Some(Box::new(|| true));

        let result = tee(ctx).await;

        assert_eq!(result.code, 130);
        assert_eq!(result.stdout, "payload");
        assert!(!file.exists());
    }

    #[tokio::test]
    async fn test_tee_ignore_interrupts_keeps_writing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("out.txt");

        let mut ctx =
            CommandContext::new(vec!["-i".to_string(), file.to_string_lossy().to_string()]);
        ctx.stdin = Some("payload".to_string());
        ctx.is_cancelled = Some(Box::new(|| true));

        let result = tee(ctx).await;

        assert!(result.is_success());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "payload");
    }
}
