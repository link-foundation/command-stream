//! Virtual `ls` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult};
use std::fs;
use std::path::Path;

/// Execute the ls command
///
/// Lists directory contents.
pub async fn ls(ctx: CommandContext) -> CommandResult {
    // Parse flags
    let mut show_all = false;
    let mut long_format = false;
    let mut paths = Vec::new();

    for arg in &ctx.args {
        if arg == "-a" || arg == "--all" {
            show_all = true;
        } else if arg == "-l" {
            long_format = true;
        } else if arg == "-la" || arg == "-al" {
            show_all = true;
            long_format = true;
        } else if arg.starts_with('-') {
            if arg.contains('a') {
                show_all = true;
            }
            if arg.contains('l') {
                long_format = true;
            }
        } else {
            paths.push(arg.clone());
        }
    }

    // Default to current directory
    if paths.is_empty() {
        paths.push(".".to_string());
    }

    let cwd = ctx.get_cwd();
    let mut outputs = Vec::new();

    for path_str in paths {
        let resolved_path = if Path::new(&path_str).is_absolute() {
            Path::new(&path_str).to_path_buf()
        } else {
            cwd.join(&path_str)
        };

        trace_lazy("VirtualCommand", || {
            format!("ls: listing {:?}", resolved_path)
        });

        if !resolved_path.exists() {
            return CommandResult::error(format!(
                "ls: cannot access '{}': No such file or directory\n",
                path_str
            ));
        }

        if resolved_path.is_file() {
            outputs.push(format_entry(&resolved_path, long_format));
        } else {
            match fs::read_dir(&resolved_path) {
                Ok(entries) => {
                    let mut entry_strs = Vec::new();

                    for entry in entries {
                        if let Ok(entry) = entry {
                            let name = entry.file_name().to_string_lossy().to_string();

                            // Skip hidden files unless -a is specified
                            if !show_all && name.starts_with('.') {
                                continue;
                            }

                            if long_format {
                                entry_strs.push(format_entry(&entry.path(), true));
                            } else {
                                entry_strs.push(name);
                            }
                        }
                    }

                    entry_strs.sort();
                    outputs.push(entry_strs.join("\n"));
                }
                Err(e) => {
                    return CommandResult::error(format!("ls: cannot open '{}': {}\n", path_str, e));
                }
            }
        }
    }

    let output = outputs.join("\n");
    if output.is_empty() {
        CommandResult::success_empty()
    } else {
        CommandResult::success(format!("{}\n", output))
    }
}

fn format_entry(path: &Path, long_format: bool) -> String {
    let name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());

    if !long_format {
        return name;
    }

    // Long format: permissions, links, owner, group, size, date, name
    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return name,
    };

    let file_type = if metadata.is_dir() { "d" } else { "-" };
    let size = metadata.len();

    // Simplified permissions
    let perms = if metadata.is_dir() {
        "drwxr-xr-x"
    } else {
        "-rw-r--r--"
    };

    format!("{} {:>8} {}", perms, size, name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_ls_current_dir() {
        let ctx = CommandContext::new(vec![]);
        let result = ls(ctx).await;
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_ls_with_path() {
        let temp = tempdir().unwrap();
        fs::write(temp.path().join("file.txt"), "test").unwrap();

        let ctx = CommandContext::new(vec![
            temp.path().to_string_lossy().to_string()
        ]);
        let result = ls(ctx).await;

        assert!(result.is_success());
        assert!(result.stdout.contains("file.txt"));
    }

    #[tokio::test]
    async fn test_ls_hidden_files() {
        let temp = tempdir().unwrap();
        fs::write(temp.path().join(".hidden"), "test").unwrap();
        fs::write(temp.path().join("visible"), "test").unwrap();

        // Without -a
        let ctx = CommandContext::new(vec![
            temp.path().to_string_lossy().to_string()
        ]);
        let result = ls(ctx).await;
        assert!(!result.stdout.contains(".hidden"));
        assert!(result.stdout.contains("visible"));

        // With -a
        let ctx = CommandContext::new(vec![
            "-a".to_string(),
            temp.path().to_string_lossy().to_string(),
        ]);
        let result = ls(ctx).await;
        assert!(result.stdout.contains(".hidden"));
        assert!(result.stdout.contains("visible"));
    }
}
