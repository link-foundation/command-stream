//! Project-local executable resolution shared by the default, zx, and Bun runners.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Directories whose `node_modules/.bin` and own path precede the usual PATH.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum PreferLocal {
    /// Leave PATH unchanged.
    #[default]
    Off,
    /// Use the command's working directory.
    Cwd,
    /// Use these directories, in order.
    Dirs(Vec<PathBuf>),
}

/// Platform PATH list separator.
pub const PATH_DELIMITER: &str = if cfg!(windows) { ";" } else { ":" };

/// Name of the PATH variable in an environment map.
pub fn path_key<'a, I>(keys: I) -> String
where
    I: IntoIterator<Item = &'a String>,
{
    if cfg!(windows) {
        keys.into_iter()
            .find(|k| k.eq_ignore_ascii_case("path"))
            .cloned()
            .unwrap_or_else(|| "Path".to_string())
    } else {
        "PATH".to_string()
    }
}

fn absolutize(dir: &Path) -> PathBuf {
    if dir.is_absolute() {
        dir.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(dir))
            .unwrap_or_else(|_| dir.to_path_buf())
    }
}

/// Build a PATH that prefers `<dir>/node_modules/.bin` and `<dir>`.
pub fn prefer_local_bin<P: AsRef<Path>>(path: Option<&str>, dirs: &[P]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for dir in dirs {
        let dir = absolutize(dir.as_ref());
        parts.push(
            dir.join("node_modules")
                .join(".bin")
                .to_string_lossy()
                .into_owned(),
        );
        parts.push(dir.to_string_lossy().into_owned());
    }
    if let Some(path) = path {
        parts.push(path.to_string());
    }
    parts.join(PATH_DELIMITER)
}

/// Compute the child's preferred PATH without changing the supplied environment.
pub(crate) fn preferred_path(
    env: Option<&HashMap<String, String>>,
    cwd: &Path,
    preference: &PreferLocal,
) -> Option<(String, String)> {
    let dirs = match preference {
        PreferLocal::Off => return None,
        PreferLocal::Cwd => vec![cwd.to_path_buf()],
        PreferLocal::Dirs(dirs) => dirs.clone(),
    };
    if dirs.is_empty() {
        return None;
    }
    let (key, current) = if let Some(env) = env {
        let key = path_key(env.keys());
        let value = env.get(&key).cloned();
        (key, value)
    } else {
        let vars: Vec<String> = std::env::vars().map(|(key, _)| key).collect();
        let key = path_key(vars.iter());
        let value = std::env::var(&key).ok();
        (key, value)
    };
    Some((key, prefer_local_bin(current.as_deref(), &dirs)))
}

/// Override only the child's PATH, leaving the supplied environment untouched.
pub(crate) fn apply_prefer_local(
    command: &mut tokio::process::Command,
    env: Option<&HashMap<String, String>>,
    cwd: &Path,
    preference: &PreferLocal,
) {
    if let Some((key, path)) = preferred_path(env, cwd, preference) {
        command.env(key, path);
    }
}
