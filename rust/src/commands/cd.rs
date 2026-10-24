//! Virtual `cd` command implementation

use crate::commands::CommandContext;
use crate::utils::{trace, CommandResult};
use std::env;
use std::path::PathBuf;

#[cfg(windows)]
fn user_facing_path(path: PathBuf) -> PathBuf {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    const VERBATIM_UNC: &[u16] = &[92, 92, 63, 92, 85, 78, 67, 92];
    const VERBATIM: &[u16] = &[92, 92, 63, 92];
    const UNC: &[u16] = &[92, 92];

    let encoded: Vec<_> = path.as_os_str().encode_wide().collect();
    if let Some(rest) = encoded.strip_prefix(VERBATIM_UNC) {
        let mut normalized = UNC.to_vec();
        normalized.extend_from_slice(rest);
        return PathBuf::from(OsString::from_wide(&normalized));
    }
    if let Some(rest) = encoded.strip_prefix(VERBATIM) {
        return PathBuf::from(OsString::from_wide(rest));
    }
    path
}

#[cfg(not(windows))]
fn user_facing_path(path: PathBuf) -> PathBuf {
    path
}

#[derive(Debug)]
pub(crate) struct CdContext {
    pub(crate) cwd: PathBuf,
    pub(crate) oldpwd: PathBuf,
}

/// Execute the cd command
///
/// Mirrors POSIX `sh`/bash semantics so that shell scripts translate directly:
///   - `cd`            -> change to $HOME (or $USERPROFILE on Windows)
///   - `cd ~`/`cd ~/x` -> tilde expands to $HOME
///   - `cd -`          -> change to $OLDPWD and print the new directory (like sh)
///   - `cd <dir>`      -> change to `<dir>` (relative paths resolve against the
///     current working directory, or the `cwd` option)
///
/// This low-level command API retains its original process-mutating behavior.
/// `ProcessRunner` and `Pipeline` use `resolve_cd` instead so their cwd and
/// environment remain invocation-local.
pub async fn cd(ctx: CommandContext) -> CommandResult {
    let (result, context) = resolve_cd(ctx).await;
    let Some(context) = context else {
        return result;
    };

    if let Err(error) = env::set_current_dir(&context.cwd) {
        trace("VirtualCommand", &format!("cd: failed: {}", error));
        return CommandResult::error(format!("cd: {}\n", error));
    }
    env::set_var("OLDPWD", &context.oldpwd);
    env::set_var("PWD", &context.cwd);
    result
}

pub(crate) async fn resolve_cd(ctx: CommandContext) -> (CommandResult, Option<CdContext>) {
    let invocation_env = ctx.env.as_ref();
    let env_value = |name: &str| {
        invocation_env
            .and_then(|values| values.get(name).cloned())
            .or_else(|| env::var(name).ok())
    };
    let home = env_value("HOME")
        .or_else(|| env_value("USERPROFILE"))
        .unwrap_or_else(|| "/".to_string());

    let base = ctx.get_cwd();
    let previous_dir = user_facing_path(std::fs::canonicalize(&base).unwrap_or(base.clone()));

    let mut print_dir = false;
    let target: String = match ctx.args.first().map(|s| s.as_str()) {
        // `cd` with no argument goes to $HOME, just like sh.
        None | Some("") => home.clone(),
        // `cd -` switches to the previous directory and prints it (sh behavior).
        Some("-") => match env_value("OLDPWD") {
            Some(oldpwd) if !oldpwd.is_empty() => {
                print_dir = true;
                oldpwd
            }
            _ => {
                trace("VirtualCommand", "cd: OLDPWD not set");
                return (CommandResult::error("cd: OLDPWD not set\n"), None);
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

    match std::fs::canonicalize(&resolved).and_then(|new_dir| {
        if new_dir.is_dir() {
            Ok(new_dir)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::NotADirectory,
                "not a directory",
            ))
        }
    }) {
        Ok(new_dir) => {
            let new_dir = user_facing_path(new_dir);
            trace(
                "VirtualCommand",
                &format!("cd: success, new dir: {}", new_dir.display()),
            );
            // A successful `cd` is silent, except for `cd -` which echoes the dir.
            let result = if print_dir {
                CommandResult::success(format!("{}\n", new_dir.display()))
            } else {
                CommandResult::success_empty()
            };
            (
                result,
                Some(CdContext {
                    cwd: new_dir,
                    oldpwd: previous_dir,
                }),
            )
        }
        Err(e) => {
            trace("VirtualCommand", &format!("cd: failed: {}", e));
            (CommandResult::error(format!("cd: {}\n", e)), None)
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
