//! The shell execution environment: Bun's `ShellExecEnv` and `EnvMap`
//! (`src/runtime/shell/interpreter.rs`, `EnvMap.rs`; MIT, Copyright (c)
//! Oven-sh / Jarred Sumner), ported by way of `js/src/bun-shell/env.mjs` and
//! the `envObject` helper of `js/src/bun-shell/interpreter.mjs`.

#![allow(dead_code)]

use std::collections::HashMap;

use super::io::{OutKind, SharedBuf, ShellIO, ShellSysError};
use super::node_path;

/// Bun's `PATH_MAX` check in `change_cwd`.
const PATH_MAX: usize = 4096;

fn norm_key(key: &str) -> String {
    if cfg!(windows) {
        key.to_uppercase()
    } else {
        key.to_string()
    }
}

/// Insertion-ordered string map; keys compare case-insensitively on Windows
/// (the first spelling of a key is kept), like Bun's `EnvMap`.
#[derive(Clone, Debug, Default)]
pub(crate) struct EnvMap {
    entries: Vec<(String, String)>,
    index: HashMap<String, usize>,
}

impl EnvMap {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn get(&self, key: &str) -> Option<&str> {
        self.index
            .get(&norm_key(key))
            .map(|&i| self.entries[i].1.as_str())
    }

    pub(crate) fn has(&self, key: &str) -> bool {
        self.index.contains_key(&norm_key(key))
    }

    pub(crate) fn set(&mut self, key: impl Into<String>, value: impl Into<String>) {
        let key = key.into();
        let value = value.into();
        match self.index.get(&norm_key(&key)) {
            Some(&i) => self.entries[i].1 = value,
            None => {
                self.index.insert(norm_key(&key), self.entries.len());
                self.entries.push((key, value));
            }
        }
    }

    /// Entries in insertion order (with the first spelling of each key).
    pub(crate) fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.entries.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl<K: Into<String>, V: Into<String>> FromIterator<(K, V)> for EnvMap {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        let mut m = EnvMap::new();
        for (k, v) in iter {
            m.set(k, v);
        }
        m
    }
}

/// Why a child environment is created (Bun's `EnvKind`; decides whether
/// buffered output is shared with the parent).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EnvKind {
    Normal,
    CmdSubst,
    Subshell,
    Pipeline,
}

/// Bun's `ShellExecEnv`.
#[derive(Clone, Debug)]
pub(crate) struct ShellExecEnv {
    /// Shell (non-exported) variables: `FOO=bar` on its own.
    pub(crate) shell_env: EnvMap,
    /// Exported variables: the environment of child processes.
    pub(crate) export_env: EnvMap,
    /// Command-local assignments: `FOO=bar cmd`.
    pub(crate) cmd_local_env: EnvMap,
    pub(crate) cwd: String,
    pub(crate) prev_cwd: String,
    pub(crate) buffered_stdout: SharedBuf,
    pub(crate) buffered_stderr: SharedBuf,
}

impl ShellExecEnv {
    /// A root environment with `export_env` and `cwd` (used as-is; call
    /// [`change_cwd`](Self::change_cwd) with `in_init` for a user cwd, like
    /// the JS interpreter constructor).
    pub(crate) fn new(export_env: EnvMap, cwd: impl Into<String>) -> Self {
        let cwd = cwd.into();
        Self {
            shell_env: EnvMap::new(),
            export_env,
            cmd_local_env: EnvMap::new(),
            prev_cwd: cwd.clone(),
            cwd,
            buffered_stdout: SharedBuf::new(),
            buffered_stderr: SharedBuf::new(),
        }
    }

    /// A child environment for a subshell, pipeline item or command
    /// substitution. Buffered output is shared with the parent only for
    /// subshells and pipeline items writing to a pipe; captured fd outputs
    /// share the captured buffer.
    pub(crate) fn dupe_for_subshell(&self, io: &ShellIO, kind: EnvKind) -> Self {
        let buf_for = |out: &OutKind, parent: &SharedBuf| match out {
            OutKind::Fd { captured, .. } => captured.clone().unwrap_or_default(),
            OutKind::Pipe if matches!(kind, EnvKind::Subshell | EnvKind::Pipeline) => {
                parent.clone()
            }
            _ => SharedBuf::new(),
        };
        Self {
            shell_env: self.shell_env.clone(),
            export_env: self.export_env.clone(),
            cmd_local_env: EnvMap::new(),
            cwd: self.cwd.clone(),
            prev_cwd: self.prev_cwd.clone(),
            buffered_stdout: buf_for(&io.stdout, &self.buffered_stdout),
            buffered_stderr: buf_for(&io.stderr, &self.buffered_stderr),
        }
    }

    /// Resolve `p` against the shell's cwd (Node's `path.resolve(cwd, p)`).
    pub(crate) fn resolve(&self, p: &str) -> String {
        node_path::resolve(&[&self.cwd, p])
    }

    /// Change directory (Bun's `change_cwd_impl`): the target must open as a
    /// directory; updates `OLDPWD` (unless initialising) and `PWD`.
    pub(crate) fn change_cwd(&mut self, new_cwd: &str, in_init: bool) -> Result<(), ShellSysError> {
        let is_abs = node_path::is_absolute(new_cwd);
        let utf16_len = |s: &str| s.encode_utf16().count();
        let required = if is_abs {
            utf16_len(new_cwd)
        } else {
            utf16_len(&self.cwd) + 1 + utf16_len(new_cwd)
        };
        if required >= PATH_MAX {
            return Err(ShellSysError::new("ENAMETOOLONG").with_syscall("chdir"));
        }
        let mut target = if is_abs {
            new_cwd.to_string()
        } else {
            node_path::join(&[&self.cwd, new_cwd])
        };
        if !is_abs && target.len() > 1 && (target.ends_with('/') || target.ends_with('\\')) {
            target.pop();
        }
        let resolved = node_path::resolve(&[&self.cwd, &target]);
        let meta = std::fs::metadata(&resolved)
            .map_err(|e| ShellSysError::from_io(&e, target.clone()).with_syscall("open"))?;
        if !meta.is_dir() {
            return Err(ShellSysError::new("ENOTDIR")
                .with_path(target)
                .with_syscall("open"));
        }
        #[cfg(unix)]
        nix::unistd::access(resolved.as_str(), nix::unistd::AccessFlags::R_OK).map_err(|e| {
            ShellSysError::from_io(&std::io::Error::from_raw_os_error(e as i32), target.clone())
                .with_syscall("open")
        })?;
        self.prev_cwd = std::mem::replace(&mut self.cwd, target);
        if !in_init {
            self.export_env.set("OLDPWD", self.prev_cwd.clone());
        }
        self.export_env.set("PWD", self.cwd.clone());
        Ok(())
    }

    /// `cd -`.
    pub(crate) fn change_prev_cwd(&mut self) -> Result<(), ShellSysError> {
        let prev = self.prev_cwd.clone();
        self.change_cwd(&prev, false)
    }

    /// `label=value`: command-local (`FOO=bar cmd`) or a shell variable.
    pub(crate) fn assign_var(&mut self, label: &str, value: impl Into<String>, cmd_local: bool) {
        if cmd_local {
            self.cmd_local_env.set(label, value);
        } else {
            self.shell_env.set(label, value);
        }
    }

    /// `$NAME` lookup: shell variables first, then exported ones.
    pub(crate) fn get_var(&self, name: &str) -> Option<&str> {
        self.shell_env
            .get(name)
            .or_else(|| self.export_env.get(name))
    }

    pub(crate) fn get_homedir(&self) -> String {
        self.get_var(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .unwrap_or("")
            .to_string()
    }

    /// The environment of a child process (the JS `envObject`): exported
    /// variables overridden by command-local ones (matched case-insensitively
    /// on Windows), in JavaScript object key order (array-index keys first,
    /// ascending, then insertion order).
    pub(crate) fn child_env(&self) -> Vec<(String, String)> {
        let mut env: Vec<(String, String)> = self
            .export_env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        for (k, v) in self.cmd_local_env.iter() {
            let existing = env.iter_mut().find(|(key, _)| {
                if cfg!(windows) {
                    key.to_uppercase() == k.to_uppercase()
                } else {
                    key == k
                }
            });
            match existing {
                Some(entry) => entry.1 = v.to_string(),
                None => env.push((k.to_string(), v.to_string())),
            }
        }
        // Stable: non-index keys keep their order.
        env.sort_by_key(|(k, _)| js_array_index(k).map_or((1, 0), |n| (0, n)));
        env
    }

    /// `PATH` of the child environment (case-insensitive on Windows).
    pub(crate) fn path_env(&self) -> String {
        self.child_env()
            .into_iter()
            .find(|(k, _)| {
                if cfg!(windows) {
                    k.to_uppercase() == "PATH"
                } else {
                    k == "PATH"
                }
            })
            .map(|(_, v)| v)
            .unwrap_or_default()
    }
}

/// A canonical JavaScript array index (`"0"`, `"42"`, below 2^32 - 1), which
/// JS objects order before other keys.
fn js_array_index(k: &str) -> Option<u64> {
    if k.is_empty() || (k.len() > 1 && k.starts_with('0')) || !k.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    k.parse::<u64>().ok().filter(|&n| n < u64::from(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bun_shell::io::{InKind, Writer};

    fn io(out: OutKind) -> ShellIO {
        ShellIO {
            stdin: InKind::Ignore,
            stdout: out.clone(),
            stderr: out,
        }
    }

    #[test]
    fn env_map_order_and_case() {
        let mut m: EnvMap = [("B", "1"), ("a", "2")].into_iter().collect();
        m.set("B", "3");
        assert_eq!(m.iter().collect::<Vec<_>>(), vec![("B", "3"), ("a", "2")]);
        m.set("b", "4");
        if cfg!(windows) {
            assert_eq!(m.len(), 2);
            assert_eq!(m.get("B"), Some("4"));
            assert_eq!(m.iter().next(), Some(("B", "4")));
        } else {
            assert_eq!(m.len(), 3);
            assert_eq!(m.get("B"), Some("3"));
            assert_eq!(m.get("b"), Some("4"));
        }
        assert!(m.has("a"));
        assert!(!m.has("zz"));
    }

    #[test]
    fn child_env_merges_cmd_local() {
        let mut sh = ShellExecEnv::new(
            [("PATH", "/bin"), ("X", "1"), ("10", "a"), ("2", "b")]
                .into_iter()
                .collect(),
            "/",
        );
        sh.assign_var("X", "2", true);
        sh.assign_var("Y", "3", true);
        sh.assign_var("Z", "shell", false);
        let env = sh.child_env();
        let keys: Vec<_> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["2", "10", "PATH", "X", "Y"]);
        assert_eq!(env[3].1, "2");
        assert_eq!(sh.path_env(), "/bin");
        assert_eq!(sh.get_var("Z"), Some("shell"));
        assert_eq!(sh.get_var("X"), Some("1"));
    }

    #[test]
    fn dupe_shares_buffers_by_kind() {
        let sh = ShellExecEnv::new(EnvMap::new(), "/");
        let pipe = io(OutKind::Pipe);
        let sub = sh.dupe_for_subshell(&pipe, EnvKind::Subshell);
        assert!(sub.buffered_stdout.ptr_eq(&sh.buffered_stdout));
        let sub = sh.dupe_for_subshell(&pipe, EnvKind::Pipeline);
        assert!(sub.buffered_stderr.ptr_eq(&sh.buffered_stderr));
        let sub = sh.dupe_for_subshell(&pipe, EnvKind::CmdSubst);
        assert!(!sub.buffered_stdout.ptr_eq(&sh.buffered_stdout));
        let cap = SharedBuf::new();
        let fd = io(OutKind::fd(Writer::stdout(), Some(cap.clone())));
        let sub = sh.dupe_for_subshell(&fd, EnvKind::Normal);
        assert!(sub.buffered_stdout.ptr_eq(&cap));
        let sub = sh.dupe_for_subshell(&io(OutKind::Ignore), EnvKind::Subshell);
        assert!(!sub.buffered_stdout.ptr_eq(&sh.buffered_stdout));
    }

    #[test]
    fn change_cwd_updates_pwd_and_errors() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("file"), "x").unwrap();
        let mut sh = ShellExecEnv::new(EnvMap::new(), root.clone());

        sh.change_cwd(&root, true).unwrap();
        assert_eq!(sh.export_env.get("OLDPWD"), None);
        assert_eq!(sh.export_env.get("PWD"), Some(root.as_str()));

        sh.change_cwd("sub/", false).unwrap();
        let sub = node_path::join(&[&root, "sub"]);
        assert_eq!(sh.cwd, sub);
        assert_eq!(sh.prev_cwd, root);
        assert_eq!(sh.export_env.get("OLDPWD"), Some(root.as_str()));
        assert_eq!(sh.export_env.get("PWD"), Some(sub.as_str()));

        sh.change_prev_cwd().unwrap();
        assert_eq!(sh.cwd, root);
        sh.change_cwd("..", false).unwrap();
        assert_eq!(sh.cwd, node_path::join(&[&root, ".."]));
        sh.change_cwd(&root, false).unwrap();

        let e = sh.change_cwd("missing", false).unwrap_err();
        assert_eq!((e.code, e.syscall), ("ENOENT", "open"));
        assert_eq!(e.path, node_path::join(&[&root, "missing"]));
        let e = sh.change_cwd("file", false).unwrap_err();
        assert_eq!((e.code, e.message()), ("ENOTDIR", "Not a directory"));
        let e = sh.change_cwd(&"a".repeat(PATH_MAX), false).unwrap_err();
        assert_eq!(
            (e.code, e.syscall, e.path.as_str()),
            ("ENAMETOOLONG", "chdir", "")
        );
        assert_eq!(sh.cwd, root);
    }

    #[test]
    fn resolve_and_homedir() {
        let mut env = EnvMap::new();
        env.set(
            if cfg!(windows) { "USERPROFILE" } else { "HOME" },
            "/home/u",
        );
        let sh = ShellExecEnv::new(env, if cfg!(windows) { "C:\\x" } else { "/x" });
        assert_eq!(sh.get_homedir(), "/home/u");
        if !cfg!(windows) {
            assert_eq!(sh.resolve("y/../z"), "/x/z");
            assert_eq!(sh.resolve("/abs"), "/abs");
        }
        assert_eq!(ShellExecEnv::new(EnvMap::new(), "/").get_homedir(), "");
    }
}
