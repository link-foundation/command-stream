//! Virtual `cat` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult, VirtualUtils};
use std::fs;

/// Execute the cat command
///
/// Concatenates and displays file contents.
pub async fn cat(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        // Read from stdin if no files specified
        if let Some(ref stdin) = ctx.stdin {
            if !stdin.is_empty() {
                return CommandResult::success(stdin.clone());
            }
        }
        return CommandResult::success_empty();
    }

    let cwd = ctx.get_cwd();
    let mut outputs = Vec::new();

    for file in &ctx.args {
        // Check for cancellation before processing each file
        if ctx.is_cancelled() {
            trace_lazy("VirtualCommand", || {
                "cat: cancelled while processing files".to_string()
            });
            return CommandResult::error_with_code("", 130); // SIGINT exit code
        }

        trace_lazy("VirtualCommand", || {
            format!("cat: reading file {:?}", file)
        });

        let resolved_path = VirtualUtils::resolve_path(file, Some(&cwd));

        match fs::read_to_string(&resolved_path) {
            Ok(content) => {
                outputs.push(content);
            }
            Err(e) => {
                let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                    format!("cat: {}: No such file or directory\n", file)
                } else if e.kind() == std::io::ErrorKind::IsADirectory
                    || (e.kind() == std::io::ErrorKind::Other && e.to_string().contains("directory"))
                {
                    format!("cat: {}: Is a directory\n", file)
                } else {
                    format!("cat: {}: {}\n", file, e)
                };
                return CommandResult::error(error_msg);
            }
        }
    }

    let output = outputs.join("");
    trace_lazy("VirtualCommand", || {
        format!("cat: success, bytes read: {}", output.len())
    });

    CommandResult::success(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_cat_file() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "Hello, World!").unwrap();

        let ctx = CommandContext::new(vec![
            temp.path().to_string_lossy().to_string()
        ]);
        let result = cat(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "Hello, World!\n");
    }

    #[tokio::test]
    async fn test_cat_stdin() {
        let mut ctx = CommandContext::new(vec![]);
        ctx.stdin = Some("stdin content".to_string());

        let result = cat(ctx).await;
        assert!(result.is_success());
        assert_eq!(result.stdout, "stdin content");
    }

    #[tokio::test]
    async fn test_cat_nonexistent() {
        let ctx = CommandContext::new(vec![
            "/nonexistent/file/12345".to_string()
        ]);
        let result = cat(ctx).await;

        assert!(!result.is_success());
        assert!(result.stderr.contains("No such file or directory"));
    }

    #[tokio::test]
    async fn test_cat_multiple_files() {
        let mut temp1 = NamedTempFile::new().unwrap();
        let mut temp2 = NamedTempFile::new().unwrap();
        write!(temp1, "file1").unwrap();
        write!(temp2, "file2").unwrap();

        let ctx = CommandContext::new(vec![
            temp1.path().to_string_lossy().to_string(),
            temp2.path().to_string_lossy().to_string(),
        ]);
        let result = cat(ctx).await;

        assert!(result.is_success());
        assert_eq!(result.stdout, "file1file2");
    }
}
