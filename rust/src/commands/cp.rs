//! Virtual `cp` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult, VirtualUtils};
use std::fs;
use std::path::Path;

/// Execute the cp command
///
/// Copies files and directories.
pub async fn cp(ctx: CommandContext) -> CommandResult {
    if ctx.args.len() < 2 {
        return VirtualUtils::invalid_argument_error("cp", "missing file operand");
    }

    // Parse flags
    let mut recursive = false;
    let mut paths = Vec::new();

    for arg in &ctx.args {
        if arg == "-r" || arg == "-R" || arg == "--recursive" {
            recursive = true;
        } else if arg.starts_with('-') {
            if arg.contains('r') || arg.contains('R') {
                recursive = true;
            }
        } else {
            paths.push(arg.clone());
        }
    }

    if paths.len() < 2 {
        return VirtualUtils::invalid_argument_error("cp", "missing destination file operand");
    }

    let cwd = ctx.get_cwd();
    let dest = paths.pop().unwrap();
    let dest_path = VirtualUtils::resolve_path(&dest, Some(&cwd));

    // If multiple sources or dest is a directory, copy into the directory
    let dest_is_dir = dest_path.is_dir();
    let multiple_sources = paths.len() > 1;

    if multiple_sources && !dest_is_dir {
        return CommandResult::error(format!(
            "cp: target '{}' is not a directory\n",
            dest
        ));
    }

    for source in paths {
        let source_path = VirtualUtils::resolve_path(&source, Some(&cwd));

        trace_lazy("VirtualCommand", || {
            format!("cp: copying {:?} to {:?}", source_path, dest_path)
        });

        if !source_path.exists() {
            return CommandResult::error(format!(
                "cp: cannot stat '{}': No such file or directory\n",
                source
            ));
        }

        let final_dest = if dest_is_dir {
            dest_path.join(source_path.file_name().unwrap_or_default())
        } else {
            dest_path.clone()
        };

        if source_path.is_dir() {
            if !recursive {
                return CommandResult::error(format!(
                    "cp: -r not specified; omitting directory '{}'\n",
                    source
                ));
            }

            if let Err(e) = copy_dir_recursive(&source_path, &final_dest) {
                return CommandResult::error(format!(
                    "cp: cannot copy '{}': {}\n",
                    source, e
                ));
            }
        } else {
            if let Some(parent) = final_dest.parent() {
                if !parent.exists() {
                    if let Err(e) = fs::create_dir_all(parent) {
                        return CommandResult::error(format!(
                            "cp: cannot create directory '{}': {}\n",
                            parent.display(), e
                        ));
                    }
                }
            }

            if let Err(e) = fs::copy(&source_path, &final_dest) {
                return CommandResult::error(format!(
                    "cp: cannot copy '{}': {}\n",
                    source, e
                ));
            }
        }
    }

    CommandResult::success_empty()
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let entry_path = entry.path();
        let dest_path = dst.join(entry.file_name());

        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &dest_path)?;
        } else {
            fs::copy(&entry_path, &dest_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_cp_file() {
        let temp = tempdir().unwrap();
        let src = temp.path().join("source.txt");
        let dst = temp.path().join("dest.txt");
        fs::write(&src, "test content").unwrap();

        let ctx = CommandContext::new(vec![
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        ]);
        let result = cp(ctx).await;

        assert!(result.is_success());
        assert!(dst.exists());
        assert_eq!(fs::read_to_string(&dst).unwrap(), "test content");
    }

    #[tokio::test]
    async fn test_cp_directory_recursive() {
        let temp = tempdir().unwrap();
        let src_dir = temp.path().join("src_dir");
        let dst_dir = temp.path().join("dst_dir");

        fs::create_dir(&src_dir).unwrap();
        fs::write(src_dir.join("file.txt"), "test").unwrap();

        let ctx = CommandContext::new(vec![
            "-r".to_string(),
            src_dir.to_string_lossy().to_string(),
            dst_dir.to_string_lossy().to_string(),
        ]);
        let result = cp(ctx).await;

        assert!(result.is_success());
        assert!(dst_dir.join("file.txt").exists());
    }

    #[tokio::test]
    async fn test_cp_directory_without_recursive() {
        let temp = tempdir().unwrap();
        let src_dir = temp.path().join("src_dir");
        let dst_dir = temp.path().join("dst_dir");

        fs::create_dir(&src_dir).unwrap();

        let ctx = CommandContext::new(vec![
            src_dir.to_string_lossy().to_string(),
            dst_dir.to_string_lossy().to_string(),
        ]);
        let result = cp(ctx).await;

        assert!(!result.is_success());
        assert!(result.stderr.contains("-r not specified"));
    }
}
