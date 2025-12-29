//! Virtual `rm` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult, VirtualUtils};
use std::fs;

/// Execute the rm command
///
/// Removes files and directories.
pub async fn rm(ctx: CommandContext) -> CommandResult {
    if ctx.args.is_empty() {
        return VirtualUtils::missing_operand_error("rm");
    }

    // Parse flags
    let mut recursive = false;
    let mut force = false;
    let mut paths = Vec::new();

    for arg in &ctx.args {
        if arg == "-r" || arg == "-R" || arg == "--recursive" {
            recursive = true;
        } else if arg == "-f" || arg == "--force" {
            force = true;
        } else if arg == "-rf" || arg == "-fr" {
            recursive = true;
            force = true;
        } else if arg.starts_with('-') {
            // Check for combined flags like -rf
            if arg.contains('r') || arg.contains('R') {
                recursive = true;
            }
            if arg.contains('f') {
                force = true;
            }
        } else {
            paths.push(arg.clone());
        }
    }

    if paths.is_empty() {
        return VirtualUtils::missing_operand_error("rm");
    }

    let cwd = ctx.get_cwd();

    for path_str in paths {
        let resolved_path = VirtualUtils::resolve_path(&path_str, Some(&cwd));

        trace_lazy("VirtualCommand", || {
            format!("rm: removing {:?}, recursive: {}, force: {}", resolved_path, recursive, force)
        });

        if !resolved_path.exists() {
            if !force {
                return CommandResult::error(format!(
                    "rm: cannot remove '{}': No such file or directory\n",
                    path_str
                ));
            }
            continue;
        }

        let result = if resolved_path.is_dir() {
            if recursive {
                fs::remove_dir_all(&resolved_path)
            } else {
                return CommandResult::error(format!(
                    "rm: cannot remove '{}': Is a directory\n",
                    path_str
                ));
            }
        } else {
            fs::remove_file(&resolved_path)
        };

        if let Err(e) = result {
            if !force {
                return CommandResult::error(format!("rm: cannot remove '{}': {}\n", path_str, e));
            }
        }
    }

    CommandResult::success_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::{tempdir, NamedTempFile};

    #[tokio::test]
    async fn test_rm_file() {
        let mut temp = NamedTempFile::new().unwrap();
        writeln!(temp, "test").unwrap();
        let path = temp.path().to_path_buf();

        // Keep the file but get the path
        let path_str = path.to_string_lossy().to_string();
        drop(temp);

        // Create file again
        fs::write(&path, "test").unwrap();

        let ctx = CommandContext::new(vec![path_str.clone()]);
        let result = rm(ctx).await;

        assert!(result.is_success());
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn test_rm_directory_recursive() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("subdir");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("file.txt"), "test").unwrap();

        let ctx = CommandContext::new(vec![
            "-r".to_string(),
            dir.to_string_lossy().to_string(),
        ]);
        let result = rm(ctx).await;

        assert!(result.is_success());
        assert!(!dir.exists());
    }

    #[tokio::test]
    async fn test_rm_nonexistent_force() {
        let ctx = CommandContext::new(vec![
            "-f".to_string(),
            "/nonexistent/file/12345".to_string(),
        ]);
        let result = rm(ctx).await;

        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_rm_nonexistent_no_force() {
        let ctx = CommandContext::new(vec![
            "/nonexistent/file/12345".to_string()
        ]);
        let result = rm(ctx).await;

        assert!(!result.is_success());
    }
}
