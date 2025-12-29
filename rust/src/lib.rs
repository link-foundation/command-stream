//! # command-stream
//!
//! Modern shell command execution library with streaming, async iteration, and event support.
//!
//! This library provides a Rust equivalent to the JavaScript command-stream library,
//! offering powerful shell command execution with streaming capabilities.
//!
//! ## Features
//!
//! - Async command execution with tokio
//! - Streaming output via async iterators
//! - Virtual commands for common operations (cat, ls, mkdir, etc.)
//! - Shell operator support (&&, ||, ;, |)
//! - Cross-platform support
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use command_stream::$;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Execute a simple command
//!     let result = $("echo hello world").await?;
//!     println!("{}", result.stdout);
//!     Ok(())
//! }
//! ```

pub mod commands;
pub mod shell_parser;
pub mod utils;

use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};

pub use commands::{CommandContext, StreamChunk};
pub use shell_parser::{parse_shell_command, needs_real_shell, ParsedCommand};
pub use utils::{AnsiConfig, AnsiUtils, CommandResult, VirtualUtils, quote, trace};

/// Error type for command-stream operations
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Command failed with exit code {code}: {message}")]
    CommandFailed { code: i32, message: String },

    #[error("Command not found: {0}")]
    CommandNotFound(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Cancelled")]
    Cancelled,
}

/// Result type for command-stream operations
pub type Result<T> = std::result::Result<T, Error>;

/// Shell settings for controlling execution behavior
#[derive(Debug, Clone, Default)]
pub struct ShellSettings {
    /// Exit immediately if a command exits with non-zero status (set -e)
    pub errexit: bool,
    /// Print commands as they are executed (set -v)
    pub verbose: bool,
    /// Print trace of commands (set -x)
    pub xtrace: bool,
    /// Return value of a pipeline is the status of the last command to exit with non-zero (set -o pipefail)
    pub pipefail: bool,
    /// Treat unset variables as an error (set -u)
    pub nounset: bool,
}

/// Options for command execution
#[derive(Debug, Clone)]
pub struct RunOptions {
    /// Mirror output to parent stdout/stderr
    pub mirror: bool,
    /// Capture output in result
    pub capture: bool,
    /// Standard input handling
    pub stdin: StdinOption,
    /// Working directory
    pub cwd: Option<PathBuf>,
    /// Environment variables
    pub env: Option<HashMap<String, String>>,
    /// Interactive mode (TTY forwarding)
    pub interactive: bool,
    /// Enable shell operator parsing
    pub shell_operators: bool,
    /// Enable tracing for this command
    pub trace: bool,
}

impl Default for RunOptions {
    fn default() -> Self {
        RunOptions {
            mirror: true,
            capture: true,
            stdin: StdinOption::Inherit,
            cwd: None,
            env: None,
            interactive: false,
            shell_operators: true,
            trace: true,
        }
    }
}

/// Standard input options
#[derive(Debug, Clone)]
pub enum StdinOption {
    /// Inherit from parent process
    Inherit,
    /// Pipe (allow writing to stdin)
    Pipe,
    /// Provide string content
    Content(String),
    /// Null device
    Null,
}

/// A running or completed process
pub struct ProcessRunner {
    command: String,
    options: RunOptions,
    child: Option<Child>,
    result: Option<CommandResult>,
    started: bool,
    finished: bool,
    cancelled: bool,
    output_tx: Option<mpsc::Sender<StreamChunk>>,
    output_rx: Option<mpsc::Receiver<StreamChunk>>,
}

impl ProcessRunner {
    /// Create a new process runner
    pub fn new(command: impl Into<String>, options: RunOptions) -> Self {
        let (tx, rx) = mpsc::channel(1024);
        ProcessRunner {
            command: command.into(),
            options,
            child: None,
            result: None,
            started: false,
            finished: false,
            cancelled: false,
            output_tx: Some(tx),
            output_rx: Some(rx),
        }
    }

    /// Start the process
    pub async fn start(&mut self) -> Result<()> {
        if self.started {
            return Ok(());
        }
        self.started = true;

        utils::trace_lazy("ProcessRunner", || {
            format!("Starting command: {}", self.command)
        });

        // Check if this is a virtual command
        let first_word = self.command.split_whitespace().next().unwrap_or("");
        if let Some(result) = self.try_virtual_command(first_word).await {
            self.result = Some(result);
            self.finished = true;
            return Ok(());
        }

        // Parse command for shell operators
        let parsed = if self.options.shell_operators && !needs_real_shell(&self.command) {
            parse_shell_command(&self.command)
        } else {
            None
        };

        // Execute via real shell if needed
        let shell = find_available_shell();

        let mut cmd = Command::new(&shell.cmd);
        for arg in &shell.args {
            cmd.arg(arg);
        }
        cmd.arg(&self.command);

        // Configure stdin
        match &self.options.stdin {
            StdinOption::Inherit => { cmd.stdin(Stdio::inherit()); }
            StdinOption::Pipe => { cmd.stdin(Stdio::piped()); }
            StdinOption::Content(_) => { cmd.stdin(Stdio::piped()); }
            StdinOption::Null => { cmd.stdin(Stdio::null()); }
        }

        // Configure stdout/stderr
        if self.options.capture || self.options.mirror {
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::piped());
        } else {
            cmd.stdout(Stdio::inherit());
            cmd.stderr(Stdio::inherit());
        }

        // Set working directory
        if let Some(ref cwd) = self.options.cwd {
            cmd.current_dir(cwd);
        }

        // Set environment
        if let Some(ref env_vars) = self.options.env {
            for (key, value) in env_vars {
                cmd.env(key, value);
            }
        }

        // Spawn the process
        let child = cmd.spawn()?;
        self.child = Some(child);

        Ok(())
    }

    /// Run the process to completion
    pub async fn run(&mut self) -> Result<CommandResult> {
        self.start().await?;

        if let Some(result) = &self.result {
            return Ok(result.clone());
        }

        let child = self.child.take().ok_or_else(|| {
            Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Process not started",
            ))
        })?;

        // Handle stdin content if provided
        if let StdinOption::Content(ref content) = self.options.stdin {
            if let Some(mut stdin) = child.stdin {
                let content = content.clone();
                tokio::spawn(async move {
                    let _ = stdin.write_all(content.as_bytes()).await;
                    let _ = stdin.shutdown().await;
                });
            }
        }

        // Collect output
        let mut stdout_content = String::new();
        let mut stderr_content = String::new();

        if let Some(stdout) = child.stdout {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if self.options.mirror {
                    println!("{}", line);
                }
                stdout_content.push_str(&line);
                stdout_content.push('\n');
            }
        }

        if let Some(stderr) = child.stderr {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if self.options.mirror {
                    eprintln!("{}", line);
                }
                stderr_content.push_str(&line);
                stderr_content.push('\n');
            }
        }

        let status = child.wait().await?;
        let code = status.code().unwrap_or(-1);

        let result = CommandResult {
            stdout: stdout_content,
            stderr: stderr_content,
            code,
        };

        self.result = Some(result.clone());
        self.finished = true;

        Ok(result)
    }

    /// Try to execute as a virtual command
    async fn try_virtual_command(&self, cmd_name: &str) -> Option<CommandResult> {
        if !commands::are_virtual_commands_enabled() {
            return None;
        }

        // Parse args from command string
        let parts: Vec<&str> = self.command.split_whitespace().collect();
        let args: Vec<String> = parts.iter().skip(1).map(|s| s.to_string()).collect();

        let ctx = CommandContext {
            args,
            stdin: match &self.options.stdin {
                StdinOption::Content(s) => Some(s.clone()),
                _ => None,
            },
            cwd: self.options.cwd.clone(),
            env: self.options.env.clone(),
            output_tx: self.output_tx.clone(),
            is_cancelled: None,
        };

        match cmd_name {
            "echo" => Some(commands::echo(ctx).await),
            "pwd" => Some(commands::pwd(ctx).await),
            "cd" => Some(commands::cd(ctx).await),
            "true" => Some(commands::r#true(ctx).await),
            "false" => Some(commands::r#false(ctx).await),
            "sleep" => Some(commands::sleep(ctx).await),
            "cat" => Some(commands::cat(ctx).await),
            "ls" => Some(commands::ls(ctx).await),
            "mkdir" => Some(commands::mkdir(ctx).await),
            "rm" => Some(commands::rm(ctx).await),
            "touch" => Some(commands::touch(ctx).await),
            "cp" => Some(commands::cp(ctx).await),
            "mv" => Some(commands::mv(ctx).await),
            "basename" => Some(commands::basename(ctx).await),
            "dirname" => Some(commands::dirname(ctx).await),
            "env" => Some(commands::env(ctx).await),
            "exit" => Some(commands::exit(ctx).await),
            "which" => Some(commands::which(ctx).await),
            "yes" => Some(commands::yes(ctx).await),
            "seq" => Some(commands::seq(ctx).await),
            "test" => Some(commands::test(ctx).await),
            _ => None,
        }
    }

    /// Kill the process
    pub fn kill(&mut self) -> Result<()> {
        self.cancelled = true;
        if let Some(ref mut child) = self.child {
            child.start_kill()?;
        }
        Ok(())
    }

    /// Check if the process is finished
    pub fn is_finished(&self) -> bool {
        self.finished
    }

    /// Get the result if available
    pub fn result(&self) -> Option<&CommandResult> {
        self.result.as_ref()
    }
}

/// Shell configuration
#[derive(Debug, Clone)]
struct ShellConfig {
    cmd: String,
    args: Vec<String>,
}

/// Find an available shell
fn find_available_shell() -> ShellConfig {
    let is_windows = cfg!(windows);

    if is_windows {
        // Windows shells
        let shells = [
            ("cmd.exe", vec!["/c"]),
            ("powershell.exe", vec!["-Command"]),
        ];

        for (cmd, args) in shells {
            if which::which(cmd).is_ok() {
                return ShellConfig {
                    cmd: cmd.to_string(),
                    args: args.into_iter().map(String::from).collect(),
                };
            }
        }

        ShellConfig {
            cmd: "cmd.exe".to_string(),
            args: vec!["/c".to_string()],
        }
    } else {
        // Unix shells
        let shells = [
            ("/bin/sh", vec!["-c"]),
            ("/usr/bin/sh", vec!["-c"]),
            ("/bin/bash", vec!["-c"]),
            ("sh", vec!["-c"]),
        ];

        for (cmd, args) in shells {
            if std::path::Path::new(cmd).exists() || which::which(cmd).is_ok() {
                return ShellConfig {
                    cmd: cmd.to_string(),
                    args: args.into_iter().map(String::from).collect(),
                };
            }
        }

        ShellConfig {
            cmd: "/bin/sh".to_string(),
            args: vec!["-c".to_string()],
        }
    }
}

/// Execute a command and return the result
///
/// This is the main entry point for simple command execution.
pub async fn $(command: impl Into<String>) -> Result<CommandResult> {
    let mut runner = ProcessRunner::new(command, RunOptions::default());
    runner.run().await
}

/// Execute a command with custom options
pub async fn exec(command: impl Into<String>, options: RunOptions) -> Result<CommandResult> {
    let mut runner = ProcessRunner::new(command, options);
    runner.run().await
}

/// Create a new process runner without starting it
pub fn create(command: impl Into<String>, options: RunOptions) -> ProcessRunner {
    ProcessRunner::new(command, options)
}

/// Execute a command synchronously (blocking)
pub fn run_sync(command: impl Into<String>) -> Result<CommandResult> {
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on($(command))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_simple_echo() {
        let result = $("echo hello").await.unwrap();
        assert!(result.is_success());
        assert!(result.stdout.contains("hello"));
    }

    #[tokio::test]
    async fn test_virtual_echo() {
        let mut runner = ProcessRunner::new("echo test virtual", RunOptions::default());
        let result = runner.run().await.unwrap();
        assert!(result.is_success());
        assert!(result.stdout.contains("test virtual"));
    }

    #[tokio::test]
    async fn test_process_runner() {
        let mut runner = ProcessRunner::new("echo hello world", RunOptions {
            mirror: false,
            ..Default::default()
        });

        let result = runner.run().await.unwrap();
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_virtual_pwd() {
        let mut runner = ProcessRunner::new("pwd", RunOptions::default());
        let result = runner.run().await.unwrap();
        assert!(result.is_success());
        assert!(!result.stdout.is_empty());
    }
}
