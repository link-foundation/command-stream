//! Lazy exact-argv command descriptions, parallel to JavaScript `$.command`.
use crate::{CommandResult, Result, StdinOption};
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Default)]
pub enum CommandStdio {
    #[default]
    Pipe,
    Inherit,
    Ignore,
}

impl CommandStdio {
    fn native(&self) -> Stdio {
        match self {
            Self::Pipe => Stdio::piped(),
            Self::Inherit => Stdio::inherit(),
            Self::Ignore => Stdio::null(),
        }
    }
}

/// Reusable builder that passes every argument literally to the executable.
#[derive(Debug, Clone)]
pub struct CommandBuilder {
    pub file: OsString,
    pub arguments: Vec<OsString>,
    cwd: Option<PathBuf>,
    // Replay changes in order so native Command applies platform-specific
    // key equality (notably case-insensitive environment names on Windows).
    env: Vec<(OsString, Option<OsString>)>,
    clear_env: bool,
    stdout: CommandStdio,
    stderr: CommandStdio,
    stdin: StdinOption,
}

impl CommandBuilder {
    pub fn new(file: impl Into<OsString>) -> Self {
        Self {
            file: file.into(),
            arguments: Vec::new(),
            cwd: None,
            env: Vec::new(),
            clear_env: false,
            stdout: CommandStdio::Pipe,
            stderr: CommandStdio::Pipe,
            stdin: StdinOption::Null,
        }
    }

    pub fn arg(mut self, arg: impl Into<OsString>) -> Self {
        self.arguments.push(arg.into());
        self
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.arguments.extend(args.into_iter().map(Into::into));
        self
    }

    pub fn cwd(mut self, path: impl Into<PathBuf>) -> Self {
        self.cwd = Some(path.into());
        self
    }
    pub fn env(mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.env.push((key.into(), Some(value.into())));
        self
    }
    pub fn envs<I, K, V>(mut self, variables: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<OsString>,
        V: Into<OsString>,
    {
        for (key, value) in variables {
            self = self.env(key, value);
        }
        self
    }
    pub fn env_remove(mut self, key: impl Into<OsString>) -> Self {
        self.env.push((key.into(), None));
        self
    }
    pub fn env_clear(mut self) -> Self {
        self.env.clear();
        self.clear_env = true;
        self
    }
    pub fn stdout(mut self, mode: CommandStdio) -> Self {
        self.stdout = mode;
        self
    }
    pub fn stderr(mut self, mode: CommandStdio) -> Self {
        self.stderr = mode;
        self
    }
    pub fn stdin(mut self, input: StdinOption) -> Self {
        self.stdin = input;
        self
    }

    /// Apply an owned builder transformation without executing the command.
    pub fn pipe(self, transform: impl FnOnce(Self) -> Self) -> Self {
        transform(self)
    }

    fn native_command(&self) -> std::process::Command {
        let mut command = std::process::Command::new(&self.file);
        command
            .args(&self.arguments)
            .stdin(match &self.stdin {
                StdinOption::Inherit => Stdio::inherit(),
                StdinOption::Null => Stdio::null(),
                _ => Stdio::piped(),
            })
            .stdout(self.stdout.native())
            .stderr(self.stderr.native());
        if self.clear_env {
            command.env_clear();
        }
        for (key, value) in &self.env {
            if let Some(value) = value {
                command.env(key, value);
            } else {
                command.env_remove(key);
            }
        }
        if let Some(cwd) = &self.cwd {
            command.current_dir(cwd);
        }
        command
    }

    pub async fn run(&self) -> Result<CommandResult> {
        let mut command = tokio::process::Command::from(self.native_command());
        command.kill_on_drop(true);
        let mut child = command.spawn()?;
        let input = child.stdin.take();
        let write = async {
            if let (Some(mut input), StdinOption::Content(data)) = (input, &self.stdin) {
                if let Err(error) = input.write_all(data.as_bytes()).await {
                    if error.kind() != std::io::ErrorKind::BrokenPipe {
                        return Err(error);
                    }
                }
            }
            Ok::<(), std::io::Error>(())
        };
        let (output, written) = tokio::join!(child.wait_with_output(), write);
        written?;
        Ok(Self::result(output?))
    }

    /// Execute synchronously, draining output while supplying buffered stdin.
    pub fn run_sync(&self) -> Result<CommandResult> {
        let mut child = self.native_command().spawn()?;
        let input = child.stdin.take();
        let output = std::thread::scope(|scope| {
            let writer = scope.spawn(|| {
                if let (Some(mut input), StdinOption::Content(data)) = (input, &self.stdin) {
                    use std::io::Write;
                    if let Err(error) = input.write_all(data.as_bytes()) {
                        if error.kind() != std::io::ErrorKind::BrokenPipe {
                            return Err(error);
                        }
                    }
                }
                Ok::<(), std::io::Error>(())
            });
            let output = child.wait_with_output();
            writer
                .join()
                .map_err(|_| std::io::Error::other("command stdin writer panicked"))??;
            output
        })?;
        Ok(Self::result(output))
    }

    fn result(output: std::process::Output) -> CommandResult {
        let code = output.status.code().unwrap_or(1);
        #[cfg(unix)]
        let code = {
            use std::os::unix::process::ExitStatusExt;
            output.status.signal().map_or(code, |signal| 128 + signal)
        };
        CommandResult::new(
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
            code,
        )
    }

    pub async fn exit_code(&self) -> Result<i32> {
        Ok(self.run().await?.code)
    }

    /// Render for a POSIX shell. Running the builder itself never uses this string.
    pub fn shell_string(&self) -> String {
        std::iter::once(&self.file)
            .chain(&self.arguments)
            .map(|value| format!("'{}'", value.to_string_lossy().replace('\'', "'\\''")))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Translate a shell script into an executable JavaScript module.
pub fn fy(source: &str) -> String {
    format!("#!/usr/bin/env node\nimport {{ command }} from 'command-stream';\nconst source = {};\nconst result = await command('sh', '-c', source, 'translated.sh', ...process.argv.slice(2)).with({{ mirror: true, capture: false, stdin: 'inherit' }}).run();\nprocess.exitCode = result.code;\n", serde_json::to_string(source).expect("string serialization"))
}
