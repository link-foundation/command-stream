//! Lazy exact-argv command descriptions, parallel to JavaScript `$.command`.
use crate::{CommandResult, Result, StdinOption};
use std::collections::HashMap;
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
    env: HashMap<OsString, OsString>,
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
            env: HashMap::new(),
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
        self.env.insert(key.into(), value.into());
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

    pub async fn run(&self) -> Result<CommandResult> {
        let mut command = tokio::process::Command::new(&self.file);
        command
            .args(&self.arguments)
            .envs(&self.env)
            .stdin(match &self.stdin {
                StdinOption::Inherit => Stdio::inherit(),
                StdinOption::Null => Stdio::null(),
                _ => Stdio::piped(),
            })
            .stdout(self.stdout.native())
            .stderr(self.stderr.native())
            .kill_on_drop(true);
        if let Some(cwd) = &self.cwd {
            command.current_dir(cwd);
        }
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
        let output = output?;
        let code = output.status.code().unwrap_or(1);
        #[cfg(unix)]
        let code = {
            use std::os::unix::process::ExitStatusExt;
            output.status.signal().map_or(code, |signal| 128 + signal)
        };
        Ok(CommandResult::new(
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
            code,
        ))
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
