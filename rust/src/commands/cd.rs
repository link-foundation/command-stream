//! Virtual `cd` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace, CommandResult};
use std::env;
use std::path::PathBuf;

/// Execute the cd command
///
/// Mirrors POSIX `sh`/bash semantics so that shell scripts translate directly:
///   - `cd`            -> change to $HOME (or $USERPROFILE on Windows)
///   - `cd ~`/`cd ~/x` -> tilde expands to $HOME
///   - `cd -`          -> change to $OLDPWD and print the new directory (like sh)
///   - `cd <dir>`      -> change to <dir> (relative paths resolve against the
///     current working directory, or the `cwd` option)
///
/// Like a real shell, a successful `cd` updates the `PWD` and `OLDPWD`
/// environment variables and changes the process directory so that subsequent
/// commands (virtual or real) observe the new location.
pub async fn cd(ctx: CommandContext) -> CommandResult {
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".to_string());

    let previous_dir = env::current_dir().ok();
    let base = ctx.get_cwd();

    let mut print_dir = false;
    let target: String = match ctx.args.first().map(|s| s.as_str()) {
        // `cd` with no argument goes to $HOME, just like sh.
        None | Some("") => home.clone(),
        // `cd -` switches to the previous directory and prints it (sh behavior).
        Some("-") => match env::var("OLDPWD") {
            Ok(oldpwd) if !oldpwd.is_empty() => {
                print_dir = true;
                oldpwd
            }
            _ => {
                trace("VirtualCommand", "cd: OLDPWD not set");
                return CommandResult::error("cd: OLDPWD not set\n");
            }
        },
        Some("~") => home.clone(),
        Some(t) if t.starts_with("~/") => PathBuf::from(&home).join(&t[2..]).display().to_string(),
        Some(t) => t.to_string(),
    };

    // Resolve relative targets against the effective base directory so that the
    // `cwd` option and chained `cd` commands behave consistently.
    let target_path = PathBuf::from(&target);
    let resolved = if target_path.is_absolute() {
        target_path
    } else {
        base.join(&target_path)
    };

    trace(
        "VirtualCommand",
        &format!("cd: changing directory to {:?}", resolved),
    );

    match env::set_current_dir(&resolved) {
        Ok(()) => {
            let new_dir = env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default();
            // Keep PWD/OLDPWD in sync with the real shell so `$PWD`-style lookups
            // and child processes observe the change.
            if let Some(prev) = previous_dir {
                env::set_var("OLDPWD", prev);
            }
            env::set_var("PWD", &new_dir);
            trace(
                "VirtualCommand",
                &format!("cd: success, new dir: {}", new_dir),
            );
            // A successful `cd` is silent, except for `cd -` which echoes the dir.
            if print_dir {
                CommandResult::success(format!("{}\n", new_dir))
            } else {
                CommandResult::success_empty()
            }
        }
        Err(e) => {
            trace("VirtualCommand", &format!("cd: failed: {}", e));
            CommandResult::error(format!("cd: {}\n", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;
    use tokio::sync::Mutex;

    // `cd` mutates process-global state (current dir + PWD/OLDPWD env vars).
    // Rust runs tests in parallel by default, so serialize the cd tests against
    // each other to avoid races on that shared state. An async-aware mutex lets
    // the guard be held across the `cd(...).await` calls without tripping
    // clippy's `await_holding_lock` lint.
    static CD_TEST_LOCK: Mutex<()> = Mutex::const_new(());

    // Normalize paths so comparisons survive symlinked temp dirs
    // (e.g. macOS `/var` -> `/private/var`).
    fn normalize(p: &Path) -> PathBuf {
        std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
    }

    #[tokio::test]
    async fn test_cd_to_temp() {
        let _guard = CD_TEST_LOCK.lock().await;
        let temp = tempdir().unwrap();
        let temp_path = temp.path().to_string_lossy().to_string();
        let original_dir = env::current_dir().unwrap();

        let ctx = CommandContext::new(vec![temp_path.clone()]);
        let result = cd(ctx).await;
        assert!(result.is_success());
        assert_eq!(result.stdout, "");
        assert_eq!(
            normalize(&env::current_dir().unwrap()),
            normalize(temp.path())
        );

        // Restore original directory
        env::set_current_dir(original_dir).unwrap();
    }

    #[tokio::test]
    async fn test_cd_to_nonexistent() {
        let _guard = CD_TEST_LOCK.lock().await;
        let original_dir = env::current_dir().unwrap();
        let ctx = CommandContext::new(vec!["/nonexistent/path/12345".to_string()]);
        let result = cd(ctx).await;
        assert!(!result.is_success());
        assert_eq!(result.code, 1);
        assert!(result.stderr.contains("cd:"));
        // A failed cd must not move the process out of its directory.
        assert_eq!(env::current_dir().unwrap(), original_dir);
    }

    #[tokio::test]
    async fn test_cd_no_arg_goes_home() {
        let _guard = CD_TEST_LOCK.lock().await;
        let temp = tempdir().unwrap();
        let original_dir = env::current_dir().unwrap();
        env::set_var("HOME", temp.path());

        let ctx = CommandContext::new(vec![]);
        let result = cd(ctx).await;
        assert!(result.is_success());
        assert_eq!(
            normalize(&env::current_dir().unwrap()),
            normalize(temp.path())
        );

        env::set_current_dir(original_dir).unwrap();
    }

    #[tokio::test]
    async fn test_cd_tilde_expands_home() {
        let _guard = CD_TEST_LOCK.lock().await;
        let temp = tempdir().unwrap();
        let original_dir = env::current_dir().unwrap();
        env::set_var("HOME", temp.path());

        let ctx = CommandContext::new(vec!["~".to_string()]);
        let result = cd(ctx).await;
        assert!(result.is_success());
        assert_eq!(
            normalize(&env::current_dir().unwrap()),
            normalize(temp.path())
        );

        env::set_current_dir(original_dir).unwrap();
    }

    #[tokio::test]
    async fn test_cd_tilde_subpath_expands() {
        let _guard = CD_TEST_LOCK.lock().await;
        let temp = tempdir().unwrap();
        std::fs::create_dir(temp.path().join("sub")).unwrap();
        let original_dir = env::current_dir().unwrap();
        env::set_var("HOME", temp.path());

        let ctx = CommandContext::new(vec!["~/sub".to_string()]);
        let result = cd(ctx).await;
        assert!(result.is_success());
        assert_eq!(
            normalize(&env::current_dir().unwrap()),
            normalize(&temp.path().join("sub"))
        );

        env::set_current_dir(original_dir).unwrap();
    }

    #[tokio::test]
    async fn test_cd_dash_switches_and_prints() {
        let _guard = CD_TEST_LOCK.lock().await;
        let dir_a = tempdir().unwrap();
        let dir_b = tempdir().unwrap();
        let original_dir = env::current_dir().unwrap();

        let _ = cd(CommandContext::new(vec![dir_a
            .path()
            .to_string_lossy()
            .to_string()]))
        .await;
        let _ = cd(CommandContext::new(vec![dir_b
            .path()
            .to_string_lossy()
            .to_string()]))
        .await;

        let result = cd(CommandContext::new(vec!["-".to_string()])).await;
        assert!(result.is_success());
        // sh prints the previous directory on `cd -`.
        assert_eq!(
            normalize(Path::new(result.stdout.trim())),
            normalize(dir_a.path())
        );
        assert_eq!(
            normalize(&env::current_dir().unwrap()),
            normalize(dir_a.path())
        );

        env::set_current_dir(original_dir).unwrap();
    }

    #[tokio::test]
    async fn test_cd_updates_pwd_and_oldpwd() {
        let _guard = CD_TEST_LOCK.lock().await;
        let dir_a = tempdir().unwrap();
        let dir_b = tempdir().unwrap();
        let original_dir = env::current_dir().unwrap();

        let _ = cd(CommandContext::new(vec![dir_a
            .path()
            .to_string_lossy()
            .to_string()]))
        .await;
        assert_eq!(
            normalize(Path::new(&env::var("PWD").unwrap())),
            normalize(dir_a.path())
        );

        let _ = cd(CommandContext::new(vec![dir_b
            .path()
            .to_string_lossy()
            .to_string()]))
        .await;
        assert_eq!(
            normalize(Path::new(&env::var("PWD").unwrap())),
            normalize(dir_b.path())
        );
        assert_eq!(
            normalize(Path::new(&env::var("OLDPWD").unwrap())),
            normalize(dir_a.path())
        );

        env::set_current_dir(original_dir).unwrap();
    }

    #[tokio::test]
    async fn test_cd_relative_resolves_against_cwd_option() {
        let _guard = CD_TEST_LOCK.lock().await;
        let temp = tempdir().unwrap();
        std::fs::create_dir(temp.path().join("sub")).unwrap();
        let original_dir = env::current_dir().unwrap();

        let mut ctx = CommandContext::new(vec!["sub".to_string()]);
        ctx.cwd = Some(temp.path().to_path_buf());
        let result = cd(ctx).await;
        assert!(result.is_success());
        assert_eq!(
            normalize(&env::current_dir().unwrap()),
            normalize(&temp.path().join("sub"))
        );

        env::set_current_dir(original_dir).unwrap();
    }
}
