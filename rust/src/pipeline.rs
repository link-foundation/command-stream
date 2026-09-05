//! Pipeline execution support
//!
//! This module provides pipeline functionality similar to the JavaScript
//! `$.process-runner-pipeline.mjs` module. It allows chaining commands
//! together with the output of one command becoming the input of the next.
//!
//! ## Usage
//!
//! ```rust,no_run
//! use command_stream::{Pipeline, run};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Create a pipeline
//!     let result = Pipeline::new()
//!         .add("echo hello world")
//!         .add("grep world")
//!         .add("wc -l")
//!         .run()
//!         .await?;
//!
//!     println!("Output: {}", result.stdout);
//!     Ok(())
//! }
//! ```

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::trace::trace_lazy;
use crate::{CommandResult, Result, RunOptions, StdinOption};

struct VirtualCommandResult {
    result: CommandResult,
    cd_context: Option<crate::commands::cd::CdContext>,
}

/// A pipeline of commands to be executed sequentially
///
/// Each command's stdout is piped to the next command's stdin.
#[derive(Debug, Clone)]
pub struct Pipeline {
    /// Commands in the pipeline
    commands: Vec<String>,
    /// Initial stdin content (optional)
    stdin: Option<String>,
    /// Working directory
    cwd: Option<PathBuf>,
    /// Environment variables
    env: Option<HashMap<String, String>>,
    /// Whether to mirror output to parent stdout/stderr
    mirror: bool,
    /// Whether to capture output
    capture: bool,
}

impl Default for Pipeline {
    fn default() -> Self {
        Self::new()
    }
}

impl Pipeline {
    /// Create a new empty pipeline
    pub fn new() -> Self {
        Pipeline {
            commands: Vec::new(),
            stdin: None,
            cwd: None,
            env: None,
            mirror: true,
            capture: true,
        }
    }

    /// Add a command to the pipeline
    // `std::ops::Add` is not a fit for a consuming builder step, and renaming
    // this method would break the published 0.x API and diverge from the
    // JavaScript `.add()` it mirrors.
    #[allow(clippy::should_implement_trait)]
    pub fn add(mut self, command: impl Into<String>) -> Self {
        self.commands.push(command.into());
        self
    }

    /// Set the initial stdin content for the first command
    pub fn stdin(mut self, content: impl Into<String>) -> Self {
        self.stdin = Some(content.into());
        self
    }

    /// Set the working directory for all commands
    pub fn cwd(mut self, path: impl Into<PathBuf>) -> Self {
        self.cwd = Some(path.into());
        self
    }

    /// Set environment variables for all commands
    pub fn env(mut self, env: HashMap<String, String>) -> Self {
        self.env = Some(env);
        self
    }

    /// Set whether to mirror output to stdout/stderr
    pub fn mirror_output(mut self, mirror: bool) -> Self {
        self.mirror = mirror;
        self
    }

    /// Set whether to capture output
    pub fn capture_output(mut self, capture: bool) -> Self {
        self.capture = capture;
        self
    }

    /// Execute the pipeline and return the result
    pub async fn run(self) -> Result<CommandResult> {
        if self.commands.is_empty() {
            return Ok(CommandResult {
                stdout: String::new(),
                stderr: "No commands in pipeline".to_string(),
                code: 1,
            });
        }

        trace_lazy("Pipeline", || {
            format!("Running pipeline with {} commands", self.commands.len())
        });

        let mut current_stdin = self.stdin.clone();
        let mut effective_cwd = self.cwd.clone();
        let mut effective_env = self.env.clone();
        let mut last_result = CommandResult {
            stdout: String::new(),
            stderr: String::new(),
            code: 0,
        };
        let mut accumulated_stderr = String::new();

        for (i, cmd_str) in self.commands.iter().enumerate() {
            let is_last = i == self.commands.len() - 1;

            trace_lazy("Pipeline", || {
                format!(
                    "Executing command {}/{}: {}",
                    i + 1,
                    self.commands.len(),
                    cmd_str
                )
            });

            // Check if this is a virtual command
            let first_word = cmd_str.split_whitespace().next().unwrap_or("");
            if crate::commands::are_virtual_commands_enabled() {
                if let Some(result) = self
                    .try_virtual_command(
                        first_word,
                        cmd_str,
                        &current_stdin,
                        effective_cwd.as_ref(),
                        effective_env.as_ref(),
                    )
                    .await
                {
                    let VirtualCommandResult { result, cd_context } = result;
                    if result.code != 0 {
                        return Ok(CommandResult {
                            stdout: result.stdout,
                            stderr: accumulated_stderr + &result.stderr,
                            code: result.code,
                        });
                    }
                    current_stdin = Some(result.stdout.clone());
                    accumulated_stderr.push_str(&result.stderr);
                    if let Some(context) = cd_context {
                        let env = effective_env.get_or_insert_with(|| std::env::vars().collect());
                        env.insert(
                            "OLDPWD".to_string(),
                            context.oldpwd.to_string_lossy().to_string(),
                        );
                        env.insert("PWD".to_string(), context.cwd.to_string_lossy().to_string());
                        effective_cwd = Some(context.cwd);
                    }
                    last_result = result;
                    continue;
                }
            }

            // Execute via shell
            let shell = find_available_shell();
            let mut cmd = Command::new(&shell.cmd);
            for arg in &shell.args {
                cmd.arg(arg);
            }
            cmd.arg(crate::utils::with_exported_process_context(
                cmd_str,
                effective_env.as_ref(),
            ));

            // Configure stdio
            cmd.stdin(Stdio::piped());
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::piped());

            // Set working directory. Fall back to a valid directory when the
            // inherited working directory has been deleted (issue #44).
            if let Some(cwd) = crate::resolve_spawn_cwd(effective_cwd.as_ref()) {
                cmd.current_dir(cwd);
            }

            // Set environment
            if let Some(ref env_vars) = effective_env {
                for (key, value) in env_vars {
                    cmd.env(key, value);
                }
            }

            // Spawn the process
            let mut child = cmd.spawn()?;

            // Write stdin if available
            if let Some(ref stdin_content) = current_stdin {
                if let Some(mut stdin) = child.stdin.take() {
                    let content = stdin_content.clone();
                    tokio::spawn(async move {
                        let _ = stdin.write_all(content.as_bytes()).await;
                        let _ = stdin.shutdown().await;
                    });
                }
            }

            // Read stdout
            let mut stdout_content = String::new();
            if let Some(mut stdout) = child.stdout.take() {
                stdout.read_to_string(&mut stdout_content).await?;
            }

            // Read stderr
            let mut stderr_content = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                stderr.read_to_string(&mut stderr_content).await?;
            }

            // Mirror output if enabled and this is the last command
            if is_last && self.mirror {
                if !stdout_content.is_empty() {
                    print!("{}", stdout_content);
                }
                if !stderr_content.is_empty() {
                    eprint!("{}", stderr_content);
                }
            }

            // Wait for the process
            let status = child.wait().await?;
            let code = status.code().unwrap_or(-1);

            accumulated_stderr.push_str(&stderr_content);

            if code != 0 {
                return Ok(CommandResult {
                    stdout: stdout_content,
                    stderr: accumulated_stderr,
                    code,
                });
            }

            // Set up stdin for next command
            current_stdin = Some(stdout_content.clone());
            last_result = CommandResult {
                stdout: stdout_content,
                stderr: String::new(),
                code,
            };
        }

        Ok(CommandResult {
            stdout: last_result.stdout,
            stderr: accumulated_stderr,
            code: last_result.code,
        })
    }

    /// Try to execute a virtual command
    async fn try_virtual_command(
        &self,
        cmd_name: &str,
        full_cmd: &str,
        stdin: &Option<String>,
        cwd: Option<&PathBuf>,
        env: Option<&HashMap<String, String>>,
    ) -> Option<VirtualCommandResult> {
        // Respect quotes and perform POSIX quote removal (issue #48), matching
        // the non-pipeline virtual-command path.
        let words = crate::shell_parser::split_command_words(full_cmd);
        let args: Vec<String> = words.into_iter().skip(1).collect();

        let ctx = crate::commands::CommandContext {
            args,
            stdin: stdin.clone(),
            cwd: cwd.cloned(),
            env: env.cloned(),
            output_tx: None,
            is_cancelled: None,
        };

        let (result, cd_context) = match cmd_name {
            "echo" => (crate::commands::echo(ctx).await, None),
            "pwd" => (crate::commands::pwd(ctx).await, None),
            "cd" => crate::commands::cd::resolve_cd(ctx).await,
            "true" => (crate::commands::r#true(ctx).await, None),
            "false" => (crate::commands::r#false(ctx).await, None),
            "sleep" => (crate::commands::sleep(ctx).await, None),
            "cat" => (crate::commands::cat(ctx).await, None),
            "ls" => (crate::commands::ls(ctx).await, None),
            "mkdir" => (crate::commands::mkdir(ctx).await, None),
            "rm" => (crate::commands::rm(ctx).await, None),
            "touch" => (crate::commands::touch(ctx).await, None),
            "cp" => (crate::commands::cp(ctx).await, None),
            "mv" => (crate::commands::mv(ctx).await, None),
            "basename" => (crate::commands::basename(ctx).await, None),
            "dirname" => (crate::commands::dirname(ctx).await, None),
            "env" => (crate::commands::env(ctx).await, None),
            "exit" => (crate::commands::exit(ctx).await, None),
            "which" => (crate::commands::which(ctx).await, None),
            "yes" => (crate::commands::yes(ctx).await, None),
            "seq" => (crate::commands::seq(ctx).await, None),
            "test" => (crate::commands::test(ctx).await, None),
            _ => return None,
        };
        Some(VirtualCommandResult { result, cd_context })
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
        ShellConfig {
            cmd: "cmd.exe".to_string(),
            args: vec!["/c".to_string()],
        }
    } else {
        let shells = [
            ("/bin/sh", "-c"),
            ("/usr/bin/sh", "-c"),
            ("/bin/bash", "-c"),
        ];

        for (cmd, arg) in shells {
            if std::path::Path::new(cmd).exists() {
                return ShellConfig {
                    cmd: cmd.to_string(),
                    args: vec![arg.to_string()],
                };
            }
        }

        ShellConfig {
            cmd: "/bin/sh".to_string(),
            args: vec!["-c".to_string()],
        }
    }
}

/// Extension trait to add `.pipe()` method to ProcessRunner
pub trait PipelineExt {
    /// Pipe the output of this command to another command
    fn pipe(self, command: impl Into<String>) -> PipelineBuilder;
}

impl PipelineExt for crate::ProcessRunner {
    fn pipe(self, command: impl Into<String>) -> PipelineBuilder {
        PipelineBuilder {
            first: self,
            additional: vec![command.into()],
        }
    }
}

/// Builder for piping commands together
pub struct PipelineBuilder {
    first: crate::ProcessRunner,
    additional: Vec<String>,
}

impl PipelineBuilder {
    /// Add another command to the pipeline
    pub fn pipe(mut self, command: impl Into<String>) -> Self {
        self.additional.push(command.into());
        self
    }

    /// Execute the pipeline
    pub async fn run(mut self) -> Result<CommandResult> {
        // First, run the initial command
        let first_result = self.first.run().await?;

        if first_result.code != 0 {
            return Ok(first_result);
        }

        // Then run the rest as a pipeline
        let mut current_stdin = Some(first_result.stdout);
        let mut accumulated_stderr = first_result.stderr;
        let mut last_result = CommandResult {
            stdout: String::new(),
            stderr: String::new(),
            code: 0,
        };

        for cmd_str in &self.additional {
            let mut runner = crate::ProcessRunner::new(
                cmd_str.clone(),
                RunOptions {
                    stdin: StdinOption::Content(current_stdin.take().unwrap_or_default()),
                    mirror: false,
                    capture: true,
                    ..Default::default()
                },
            );

            let result = runner.run().await?;
            accumulated_stderr.push_str(&result.stderr);

            if result.code != 0 {
                return Ok(CommandResult {
                    stdout: result.stdout,
                    stderr: accumulated_stderr,
                    code: result.code,
                });
            }

            current_stdin = Some(result.stdout.clone());
            last_result = result;
        }

        Ok(CommandResult {
            stdout: last_result.stdout,
            stderr: accumulated_stderr,
            code: last_result.code,
        })
    }
}
