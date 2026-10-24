//! ShellJS-style asynchronous command calls backed by the portable command
//! engine. Sessions own their cwd, directory stack, configuration and errors.
//! See `js/docs/SHELLJS_MIGRATION.md` for the JavaScript/Rust mapping and limits.
mod extra;

use crate::commands::{cd::resolve_cd, VirtualCommandRegistry};
use crate::{
    quote, CommandContext, CommandResult, ProcessRunner, Result, RunOptions, StreamingRunner,
};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

/// Configuration for a ShellJS-style session.
#[derive(Debug, Clone)]
pub struct Config {
    /// Suppress mirroring of completed results.
    pub silent: bool,
    /// Convert nonzero exit codes to `Error::CommandFailed`.
    pub fatal: bool,
    /// Print commands before execution.
    pub verbose: bool,
    /// Expand file operand globs relative to the session cwd.
    pub glob: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            silent: false,
            fatal: false,
            verbose: false,
            glob: true,
        }
    }
}

/// A portable Rust counterpart of the ShellJS command-call interface.
/// Arguments are individual values; command calls never concatenate them as
/// shell syntax. Unlike JavaScript ShellJS, cwd changes affect this session only.
#[derive(Debug)]
pub struct ShellJs {
    /// Session configuration.
    pub config: Config,
    /// Environment used by commands.
    pub env: HashMap<String, String>,
    cwd: PathBuf,
    stack: Vec<PathBuf>,
    last_error: Option<String>,
    last_code: i32,
}
impl Default for ShellJs {
    fn default() -> Self {
        Self::new()
    }
}

macro_rules! methods {
    ($($name:ident),* $(,)?) => { $(
        #[doc = concat!("Run `", stringify!($name), "` with separate argument values.")]
        pub async fn $name(&mut self, args: &[&str]) -> Result<CommandResult> {
            self.call(stringify!($name), args).await
        }
    )* };
}

impl ShellJs {
    /// Create a session rooted in the current directory.
    pub fn new() -> Self {
        let cwd = std::env::current_dir().unwrap_or_else(|_| std::env::temp_dir());
        let mut env: HashMap<String, String> = std::env::vars().collect();
        env.insert("PWD".into(), cwd.display().to_string());
        Self {
            config: Config::default(),
            env,
            cwd,
            stack: Vec::new(),
            last_error: None,
            last_code: 0,
        }
    }
    /// Current session directory.
    pub fn cwd(&self) -> &std::path::Path {
        &self.cwd
    }
    /// Error text from the last command, or None after success.
    pub fn error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
    /// Exit code of the last command.
    pub fn error_code(&self) -> i32 {
        self.last_code
    }

    fn finish(&mut self, result: CommandResult) -> Result<CommandResult> {
        self.last_code = result.code;
        self.last_error = if result.code != 0 {
            Some(result.stderr.to_string())
        } else {
            None
        };
        if !self.config.silent {
            let _ = std::io::stdout().write_all(result.stdout.as_bytes());
            let _ = std::io::stderr().write_all(result.stderr.as_bytes());
        }
        if self.config.fatal {
            result.error_for_status()
        } else {
            Ok(result)
        }
    }

    fn context(&self, args: &[&str]) -> CommandContext {
        let mut context = CommandContext::new(args.iter().map(|arg| arg.to_string()).collect());
        context.cwd = Some(self.cwd.clone());
        context.env = Some(self.env.clone());
        context
    }

    fn expand(&self, command: &str, args: &[&str]) -> Vec<String> {
        args.iter()
            .flat_map(|arg| {
                if !self.config.glob
                    || matches!(
                        command,
                        "echo" | "sed" | "grep" | "test" | "basename" | "dirname"
                    )
                    || arg.starts_with('-')
                    || !arg.contains(['*', '?', '['])
                {
                    return vec![arg.to_string()];
                }
                let pattern = self.cwd.join(arg).display().to_string();
                let matches = glob::glob(&pattern)
                    .map(|paths| {
                        paths
                            .flatten()
                            .map(|path| path.display().to_string())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if matches.is_empty() {
                    vec![arg.to_string()]
                } else {
                    matches
                }
            })
            .collect()
    }

    /// Run a supported ShellJS command. Unsupported command names return 127;
    /// external programs use `cmd` (argv) or `exec` (explicit shell syntax).
    pub async fn call(&mut self, command: &str, args: &[&str]) -> Result<CommandResult> {
        if command == "cd" {
            return self.cd(args).await;
        }
        let expanded = self.expand(command, args);
        let args: Vec<&str> = expanded.iter().map(String::as_str).collect();
        if self.config.verbose {
            eprintln!("{command} {args:?}");
        }
        let context = self.context(&args);
        let registry = VirtualCommandRegistry::with_builtins();
        let result = match command {
            "find" | "grep" | "sed" | "ln" | "chmod" => extra::run(command, context).await,
            _ => match registry.get(command) {
                Some(handler) => handler(context).await,
                None => CommandResult::error_with_code(
                    format!("shelljs: unsupported command: {command}"),
                    127,
                ),
            },
        };
        self.finish(result)
    }

    methods!(
        cat, chmod, cp, echo, find, grep, head, ln, ls, mkdir, mv, pwd, rm, sed, sort, tail, touch,
        uniq, which, basename, dirname, sleep, env, seq, tee
    );

    /// Change this session's directory without changing the host process cwd.
    pub async fn cd(&mut self, args: &[&str]) -> Result<CommandResult> {
        let (result, context) = resolve_cd(self.context(args)).await;
        if let Some(context) = context {
            self.env
                .insert("PWD".into(), context.cwd.display().to_string());
            self.env
                .insert("OLDPWD".into(), context.oldpwd.display().to_string());
            self.cwd = context.cwd;
        }
        self.finish(result)
    }
    /// Evaluate a file test, returning a boolean.
    pub async fn test(&mut self, args: &[&str]) -> Result<bool> {
        Ok(self.call("test", args).await?.code == 0)
    }
    /// Execute a program with exact arguments, bypassing the shell.
    pub async fn cmd(&mut self, program: &str, args: &[&str]) -> Result<CommandResult> {
        let result = StreamingRunner::from_argv(program, args)
            .cwd(self.cwd.clone())
            .env(self.env.clone())
            .collect()
            .await?;
        self.finish(result)
    }
    /// Execute an explicitly supplied shell command.
    pub async fn exec(&mut self, command: &str) -> Result<CommandResult> {
        let options = RunOptions {
            mirror: false,
            cwd: Some(self.cwd.clone()),
            env: Some(self.env.clone()),
            ..RunOptions::default()
        };
        let result = ProcessRunner::new(command, options).run().await?;
        self.finish(result)
    }
    /// List the current directory followed by the saved directory stack.
    pub fn dirs(&self) -> CommandResult {
        CommandResult::success(
            std::iter::once(&self.cwd)
                .chain(self.stack.iter().rev())
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join("\n"),
        )
    }
    /// Save the current directory and change to the provided directory.
    pub async fn pushd(&mut self, args: &[&str]) -> Result<CommandResult> {
        let previous = self.cwd.clone();
        let result = self.cd(args).await?;
        if result.code == 0 {
            self.stack.push(previous);
        }
        Ok(result)
    }
    /// Restore the most recently saved directory.
    pub async fn popd(&mut self) -> Result<CommandResult> {
        let Some(path) = self.stack.last().cloned() else {
            return self.finish(CommandResult::error("popd: directory stack empty"));
        };
        let result = self.cd(&[&path.display().to_string()]).await?;
        if result.code == 0 {
            self.stack.pop();
        }
        Ok(result)
    }
    /// Return the platform temporary directory.
    pub fn tempdir(&self) -> PathBuf {
        std::env::temp_dir()
    }
    /// Set fatal (`-e`/`+e`), verbose (`-v`/`+v`) or glob (`-f`/`+f`) modes.
    pub fn set(&mut self, option: &str) -> Result<CommandResult> {
        match option {
            "-e" => self.config.fatal = true,
            "+e" => self.config.fatal = false,
            "-v" => self.config.verbose = true,
            "+v" => self.config.verbose = false,
            "-f" => self.config.glob = false,
            "+f" => self.config.glob = true,
            _ => return self.finish(CommandResult::error("set: unsupported option")),
        }
        self.finish(CommandResult::success_empty())
    }
    /// Write captured stdout to a file (`append=true` corresponds to `toEnd`).
    pub async fn to(
        &mut self,
        result: &CommandResult,
        path: &str,
        append: bool,
    ) -> Result<CommandResult> {
        use tokio::io::AsyncWriteExt;
        let write = async {
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .append(append)
                .truncate(!append)
                .open(self.cwd.join(path))
                .await?;
            file.write_all(result.stdout.as_bytes()).await?;
            file.flush().await
        }
        .await;
        self.finish(match write {
            Ok(()) => CommandResult::success_empty(),
            Err(error) => CommandResult::error(format!("to: {path}: {error}")),
        })
    }
    /// Build a safely quoted native command for explicit mixed pipelines.
    pub fn command(&self, name: &str, args: &[&str]) -> String {
        std::iter::once(name)
            .chain(args.iter().copied())
            .map(quote)
            .collect::<Vec<_>>()
            .join(" ")
    }
}
