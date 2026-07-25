//! Virtual `$fy` command implementation — shell to mjs translator.
//!
//! This module is only the command-line surface. The translation itself is
//! rule-based and lives in [`crate::fy`]: the script is first formalized as a
//! link-foundation/meta-language links network, then rewritten into JavaScript
//! by a `TranslationRuleSet`.

use std::collections::BTreeSet;
use std::fs;

use crate::commands::CommandContext;
use crate::fy::{translate_shell_to_mjs, TranslateOptions};
use crate::utils::{CommandResult, VirtualUtils};

const USAGE: &str = r#"$fy - Convert shell scripts to command-stream JavaScript modules

Usage:
  $fy <input.sh>              # Translate and print to stdout
  $fy <input.sh> <output.mjs> # Translate and save to a file
  echo "ls -la" | $fy         # Translate from stdin

Options:
  --no-shebang                Omit the leading #!/usr/bin/env node line
  -h, --help                  Show this help

Examples:
  $fy deploy.sh                    # Print the translated deploy script
  $fy build.sh build.mjs           # Translate build.sh into build.mjs
  echo "cd /tmp && ls" | $fy       # Translate a one-liner from stdin

The translation is driven by substitution rules over a meta-language links
network, so pipelines, &&/||, if/while/until/for/case, functions, redirects,
variable assignments and ${...} expansions all translate structurally rather
than textually.
"#;

/// Renders translation diagnostics as shell-style warnings.
fn format_diagnostics(diagnostics: &[String]) -> String {
    let unique: BTreeSet<&String> = diagnostics.iter().collect();
    unique
        .into_iter()
        .map(|message| format!("$fy: warning: {message}\n"))
        .collect()
}

/// Execute the `$fy` command.
pub async fn fy(ctx: CommandContext) -> CommandResult {
    if ctx.args.iter().any(|arg| arg == "-h" || arg == "--help") {
        return CommandResult::success(USAGE);
    }

    let options = TranslateOptions {
        shebang: !ctx.args.iter().any(|arg| arg == "--no-shebang"),
        ..TranslateOptions::default()
    };
    let positional: Vec<&String> = ctx
        .args
        .iter()
        .filter(|argument| !argument.starts_with('-'))
        .collect();

    // A file argument always wins: `$fy in.sh` must read `in.sh` even when the
    // command happens to inherit a non-empty stdin from its caller.
    let stdin = ctx
        .stdin
        .as_deref()
        .filter(|stdin| positional.is_empty() && !stdin.is_empty());

    let source = match (stdin, positional.first()) {
        (Some(stdin), _) => stdin.to_string(),
        (None, Some(path)) => {
            let resolved = VirtualUtils::resolve_path(path, Some(&ctx.get_cwd()));
            match fs::read_to_string(&resolved) {
                Ok(source) => source,
                Err(error) => {
                    return CommandResult::error(format!("$fy: cannot read '{path}': {error}\n"))
                }
            }
        }
        (None, None) => return CommandResult::error(USAGE),
    };

    let translated = translate_shell_to_mjs(&source, &options);
    let stderr = format_diagnostics(&translated.diagnostics);

    let output_file = if stdin.is_some() {
        None
    } else {
        positional.get(1)
    };
    let Some(output_file) = output_file else {
        return CommandResult {
            stdout: translated.code,
            stderr,
            code: 0,
        };
    };

    let resolved = VirtualUtils::resolve_path(output_file, Some(&ctx.get_cwd()));
    if let Err(error) = fs::write(&resolved, &translated.code) {
        return CommandResult::error(format!(
            "{stderr}$fy: cannot write '{output_file}': {error}\n"
        ));
    }
    CommandResult {
        stdout: format!("Translated to '{output_file}'\n"),
        stderr,
        code: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn translates_a_file_argument() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "ls -la").unwrap();

        let ctx = CommandContext::new(vec![temp.path().to_string_lossy().to_string()]);
        let result = fy(ctx).await;

        assert!(result.is_success());
        assert!(result.stdout.contains("await $`ls -la`;"));
        assert!(result.stdout.starts_with("#!/usr/bin/env node\n"));
    }

    #[tokio::test]
    async fn translates_stdin() {
        let mut ctx = CommandContext::new(vec![]);
        ctx.stdin = Some("echo hi\n".to_string());
        let result = fy(ctx).await;

        assert!(result.is_success());
        assert!(result.stdout.contains("await $`echo hi`;"));
    }

    #[tokio::test]
    async fn a_file_argument_wins_over_inherited_stdin() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "pwd").unwrap();

        let mut ctx = CommandContext::new(vec![temp.path().to_string_lossy().to_string()]);
        ctx.stdin = Some("echo from-stdin\n".to_string());
        let result = fy(ctx).await;

        assert!(result.stdout.contains("await $`pwd`;"));
        assert!(!result.stdout.contains("from-stdin"));
    }

    #[tokio::test]
    async fn writes_to_an_output_file() {
        let mut input = NamedTempFile::new().unwrap();
        writeln!(input, "echo hi").unwrap();
        let output = NamedTempFile::new().unwrap();

        let ctx = CommandContext::new(vec![
            input.path().to_string_lossy().to_string(),
            output.path().to_string_lossy().to_string(),
        ]);
        let result = fy(ctx).await;

        assert!(result.is_success());
        assert!(result.stdout.starts_with("Translated to '"));
        let written = fs::read_to_string(output.path()).unwrap();
        assert!(written.contains("await $`echo hi`;"));
    }

    #[tokio::test]
    async fn omits_the_shebang_on_request() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "ls").unwrap();

        let ctx = CommandContext::new(vec![
            temp.path().to_string_lossy().to_string(),
            "--no-shebang".to_string(),
        ]);
        let result = fy(ctx).await;

        assert!(!result.stdout.contains("#!/usr/bin/env node"));
    }

    #[tokio::test]
    async fn reports_usage_without_input() {
        let result = fy(CommandContext::new(vec![])).await;
        assert_eq!(result.code, 1);
        assert!(result.stderr.contains("Usage:"));

        let help = fy(CommandContext::new(vec!["--help".to_string()])).await;
        assert!(help.is_success());
        assert!(help.stdout.contains("Usage:"));
    }

    #[tokio::test]
    async fn reports_an_unreadable_file() {
        let ctx = CommandContext::new(vec!["/nonexistent/script.sh".to_string()]);
        let result = fy(ctx).await;

        assert_eq!(result.code, 1);
        assert!(result.stderr.starts_with("$fy: cannot read "));
    }
}
