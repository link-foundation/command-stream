//! Virtual `mv` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace_lazy, CommandResult, VirtualUtils};
use std::fs;

/// Execute the mv command
///
/// Moves (renames) files and directories.
pub async fn mv(ctx: CommandContext) -> CommandResult {
    if ctx.args.len() < 2 {
        return VirtualUtils::invalid_argument_error("mv", "missing file operand");
    }

    // Parse flags (currently just skip them)
    let mut paths = Vec::new();

    for arg in &ctx.args {
        if !arg.starts_with('-') {
            paths.push(arg.clone());
        }
    }

    if paths.len() < 2 {
        return VirtualUtils::invalid_argument_error("mv", "missing destination file operand");
    }

    let cwd = ctx.get_cwd();
    let dest = paths.pop().unwrap();
    let dest_path = VirtualUtils::resolve_path(&dest, Some(&cwd));

    // If multiple sources or dest is a directory, move into the directory
    let dest_is_dir = dest_path.is_dir();
    let multiple_sources = paths.len() > 1;

    if multiple_sources && !dest_is_dir {
        return CommandResult::error(format!(
            "mv: target '{}' is not a directory\n",
            dest
        ));
    }

    for source in paths {
        let source_path = VirtualUtils::resolve_path(&source, Some(&cwd));

        trace_lazy("VirtualCommand", || {
            format!("mv: moving {:?} to {:?}", source_path, dest_path)
        });

        if !source_path.exists() {
            return CommandResult::error(format!(
                "mv: cannot stat '{}': No such file or directory\n",
                source
            ));
        }

        let final_dest = if dest_is_dir {
            dest_path.join(source_path.file_name().unwrap_or_default())
        } else {
            dest_path.clone()
        };

        // Try rename first (fastest if on same filesystem)
        match fs::rename(&source_path, &final_dest) {
            Ok(()) => continue,
            Err(e) => {
                // If rename fails (e.g., cross-filesystem), try copy + delete
                if e.kind() == std::io::ErrorKind::CrossesDevices
                    || e.kind() == std::io::ErrorKind::Other
                {
                    if source_path.is_dir() {
                        if let Err(e) = copy_and_remove_dir(&source_path, &final_dest) {
                            return CommandResult::error(format!(
                                "mv: cannot move '{}': {}\n",
                                source, e
                            ));
                        }
                    } else {
                        if let Err(e) = fs::copy(&source_path, &final_dest) {
                            return CommandResult::error(format!(
                                "mv: cannot move '{}': {}\n",
                                source, e
                            ));
                        }
                        if let Err(e) = fs::remove_file(&source_path) {
                            return CommandResult::error(format!(
                                "mv: cannot remove '{}': {}\n",
                                source, e
                            ));
                        }
                    }
                } else {
                    return CommandResult::error(format!(
                        "mv: cannot move '{}': {}\n",
                        source, e
                    ));
                }
            }
        }
    }

    CommandResult::success_empty()
}

fn copy_and_remove_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let entry_path = entry.path();
        let dest_path = dst.join(entry.file_name());

        if entry_path.is_dir() {
            copy_and_remove_dir(&entry_path, &dest_path)?;
        } else {
            fs::copy(&entry_path, &dest_path)?;
        }
    }

    fs::remove_dir_all(src)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_mv_file() {
        let temp = tempdir().unwrap();
        let src = temp.path().join("source.txt");
        let dst = temp.path().join("dest.txt");
        fs::write(&src, "test content").unwrap();

        let ctx = CommandContext::new(vec![
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        ]);
        let result = mv(ctx).await;

        assert!(result.is_success());
        assert!(!src.exists());
        assert!(dst.exists());
        assert_eq!(fs::read_to_string(&dst).unwrap(), "test content");
    }

    #[tokio::test]
    async fn test_mv_directory() {
        let temp = tempdir().unwrap();
        let src_dir = temp.path().join("src_dir");
        let dst_dir = temp.path().join("dst_dir");

        fs::create_dir(&src_dir).unwrap();
        fs::write(src_dir.join("file.txt"), "test").unwrap();

        let ctx = CommandContext::new(vec![
            src_dir.to_string_lossy().to_string(),
            dst_dir.to_string_lossy().to_string(),
        ]);
        let result = mv(ctx).await;

        assert!(result.is_success());
        assert!(!src_dir.exists());
        assert!(dst_dir.join("file.txt").exists());
    }

    #[tokio::test]
    async fn test_mv_nonexistent() {
        let temp = tempdir().unwrap();

        let ctx = CommandContext::new(vec![
            "/nonexistent/file".to_string(),
            temp.path().join("dest").to_string_lossy().to_string(),
        ]);
        let result = mv(ctx).await;

        assert!(!result.is_success());
    }
}
