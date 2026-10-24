//! Virtual `$fy` command: the CLI delegates all rendering to typed-link rules.
use crate::commands::CommandContext;
use crate::fy::{
    cli::{parse_arguments, USAGE},
    translate_shell_to_mjs, translate_source, TranslateOptions,
};
use crate::utils::{CommandResult, VirtualUtils};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;

/// Execute source migration, refusing to overwrite an existing output file.
pub async fn fy(ctx: CommandContext) -> CommandResult {
    let mut parsed = match parse_arguments(&ctx.args) {
        Ok(parsed) => parsed,
        Err(error) => return CommandResult::error(format!("$fy: translation failed: {error}\n")),
    };
    if parsed.help {
        return CommandResult::success(USAGE);
    }
    let input = parsed.positional.first();
    if let Some(path) = input.filter(|path| path.as_str() != "-") {
        parsed.options.name = std::path::Path::new(path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
    }
    let source = if input.is_none_or(|path| path == "-") {
        match ctx.stdin.as_deref().filter(|value| !value.is_empty()) {
            Some(source) => source.to_owned(),
            None => return CommandResult::error(USAGE),
        }
    } else {
        let path = input.unwrap();
        match fs::read_to_string(VirtualUtils::resolve_path(path, Some(&ctx.get_cwd()))) {
            Ok(source) => source,
            Err(error) => {
                return CommandResult::error(format!("$fy: cannot read '{path}': {error}\n"))
            }
        }
    };
    let translated = if parsed.structural {
        translate_shell_to_mjs(
            &source,
            &TranslateOptions {
                shebang: parsed.options.shebang,
                module_name: parsed.options.module_name,
            },
        )
    } else {
        match translate_source(&source, &parsed.options) {
            Ok(result) => result,
            Err(error) => {
                return CommandResult::error(format!("$fy: translation failed: {error}\n"))
            }
        }
    };
    let warnings: BTreeSet<_> = translated.diagnostics.iter().collect();
    let stderr: String = warnings
        .into_iter()
        .map(|message| format!("$fy: warning: {message}\n"))
        .collect();
    let Some(output) = parsed.positional.get(1) else {
        return CommandResult::new(translated.code, stderr, 0);
    };
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o755);
    }
    let write = || -> std::io::Result<()> {
        options
            .open(VirtualUtils::resolve_path(output, Some(&ctx.get_cwd())))?
            .write_all(translated.code.as_bytes())
    };
    if let Err(error) = write() {
        return CommandResult::error(format!("{stderr}$fy: cannot write '{output}': {error}\n"));
    }
    CommandResult::new(format!("Translated to '{output}'\n"), stderr, 0)
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

        let ctx = CommandContext::new(vec![
            "--structural".into(),
            temp.path().to_string_lossy().to_string(),
        ]);
        let result = fy(ctx).await;

        assert!(result.is_success());
        assert!(result.stdout.contains("await $`ls -la`;"));
        assert!(result.stdout.starts_with("#!/usr/bin/env node\n"));
    }

    #[tokio::test]
    async fn translates_stdin() {
        let mut ctx = CommandContext::new(vec!["--structural".into()]);
        ctx.stdin = Some("echo hi\n".to_string());
        let result = fy(ctx).await;

        assert!(result.is_success());
        assert!(result.stdout.contains("await $`echo hi`;"));
    }

    #[tokio::test]
    async fn a_file_argument_wins_over_inherited_stdin() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "pwd").unwrap();

        let mut ctx = CommandContext::new(vec![
            "--structural".into(),
            temp.path().to_string_lossy().to_string(),
        ]);
        ctx.stdin = Some("echo from-stdin\n".to_string());
        let result = fy(ctx).await;

        assert!(result.stdout.contains("await $`pwd`;"));
        assert!(!result.stdout.contains("from-stdin"));
    }

    #[tokio::test]
    async fn writes_to_an_output_file() {
        let mut input = NamedTempFile::new().unwrap();
        writeln!(input, "echo hi").unwrap();
        let output_dir = tempfile::tempdir().unwrap();
        let output = output_dir.path().join("out.mjs");

        let ctx = CommandContext::new(vec![
            "--structural".into(),
            input.path().to_string_lossy().to_string(),
            output.as_path().to_string_lossy().to_string(),
        ]);
        let result = fy(ctx).await;

        assert!(result.is_success());
        assert!(result.stdout.starts_with("Translated to '"));
        let written = fs::read_to_string(output.as_path()).unwrap();
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
