use crate::model::AdapterMetadata;
use crate::BenchmarkResult;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Output;

pub const EXPECTED_ADAPTERS: &[&str] = &[
    "command-stream",
    "std::process",
    "Tokio process",
    "async-process",
    "duct",
    "subprocess",
    "xshell",
];

#[derive(Debug, Clone, Copy)]
pub enum Adapter {
    CommandStream,
    StdProcess,
    TokioProcess,
    AsyncProcess,
    Duct,
    Subprocess,
    Xshell,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Execution {
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl Adapter {
    pub fn all() -> Vec<Self> {
        vec![
            Self::CommandStream,
            Self::StdProcess,
            Self::TokioProcess,
            Self::AsyncProcess,
            Self::Duct,
            Self::Subprocess,
            Self::Xshell,
        ]
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::CommandStream => "command-stream",
            Self::StdProcess => "std::process",
            Self::TokioProcess => "Tokio process",
            Self::AsyncProcess => "async-process",
            Self::Duct => "duct",
            Self::Subprocess => "subprocess",
            Self::Xshell => "xshell",
        }
    }

    pub fn version(self) -> String {
        match self {
            Self::CommandStream => command_stream_version(),
            Self::StdProcess => format!("{} standard library", rustc_version()),
            Self::TokioProcess => "1.53.1".to_string(),
            Self::AsyncProcess => "2.5.0".to_string(),
            Self::Duct => "1.1.2".to_string(),
            Self::Subprocess => "1.2.1".to_string(),
            Self::Xshell => "0.2.7".to_string(),
        }
    }

    pub fn metadata(self) -> AdapterMetadata {
        AdapterMetadata {
            name: self.name().to_string(),
            version: self.version(),
        }
    }

    pub async fn run(
        self,
        program: impl AsRef<Path>,
        arguments: &[String],
    ) -> BenchmarkResult<Execution> {
        let program = program.as_ref().to_path_buf();
        let arguments = arguments.to_vec();
        match self {
            Self::CommandStream => {
                let mut result = command_stream::StreamingRunner::from_argv(program, arguments)
                    .collect()
                    .await?;
                let mut stdout = Vec::new();
                let mut stderr = Vec::new();
                result.stdout.read_to_end(&mut stdout)?;
                result.stderr.read_to_end(&mut stderr)?;
                Ok(Execution {
                    exit_code: result.code,
                    stdout,
                    stderr,
                })
            }
            Self::TokioProcess => {
                let output = tokio::process::Command::new(program)
                    .args(arguments)
                    .output()
                    .await?;
                Ok(output.into())
            }
            Self::AsyncProcess => {
                let output = async_process::Command::new(program)
                    .args(arguments)
                    .output()
                    .await?;
                Ok(output.into())
            }
            Self::StdProcess => {
                run_blocking(move || std::process::Command::new(program).args(arguments).output())
                    .await
            }
            Self::Duct => {
                run_blocking(move || {
                    duct::cmd(program, arguments)
                        .stdout_capture()
                        .stderr_capture()
                        .unchecked()
                        .run()
                })
                .await
            }
            Self::Subprocess => {
                let capture = tokio::task::spawn_blocking(move || {
                    subprocess::Exec::cmd(program.into_os_string())
                        .args(&arguments)
                        .capture()
                })
                .await??;
                let exit_code = capture
                    .exit_status
                    .code()
                    .and_then(|code| i32::try_from(code).ok())
                    .or_else(|| capture.exit_status.signal().map(|signal| 128 + signal))
                    .unwrap_or(1);
                Ok(Execution {
                    exit_code,
                    stdout: capture.stdout,
                    stderr: capture.stderr,
                })
            }
            Self::Xshell => {
                run_blocking(move || {
                    let shell = xshell::Shell::new().map_err(std::io::Error::other)?;
                    xshell::cmd!(shell, "{program} {arguments...}")
                        .quiet()
                        .ignore_status()
                        .output()
                        .map_err(std::io::Error::other)
                })
                .await
            }
        }
    }
}

fn command_stream_version() -> String {
    include_str!("../../Cargo.toml")
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix("version = \"")
                .and_then(|value| value.strip_suffix('"'))
        })
        .unwrap_or("unknown")
        .to_string()
}

fn rustc_version() -> String {
    std::process::Command::new("rustc")
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map_or_else(|| "Rust".to_string(), |value| value.trim().to_string())
}

async fn run_blocking<F>(operation: F) -> BenchmarkResult<Execution>
where
    F: FnOnce() -> std::io::Result<Output> + Send + 'static,
{
    let output = tokio::task::spawn_blocking(operation).await??;
    Ok(output.into())
}

impl From<Output> for Execution {
    fn from(output: Output) -> Self {
        Self {
            exit_code: exit_code(&output.status),
            stdout: output.stdout,
            stderr: output.stderr,
        }
    }
}

fn exit_code(status: &std::process::ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.signal().map_or(1, |signal| 128 + signal)
    }
    #[cfg(not(unix))]
    1
}

pub fn select_adapters(names: Option<&[String]>) -> BenchmarkResult<Vec<Adapter>> {
    let available = Adapter::all();
    let Some(names) = names else {
        return Ok(available);
    };
    let selected = available
        .into_iter()
        .filter(|adapter| names.iter().any(|name| name == adapter.name()))
        .collect::<Vec<_>>();
    let unavailable = names
        .iter()
        .filter(|name| !selected.iter().any(|adapter| adapter.name() == *name))
        .cloned()
        .collect::<Vec<_>>();
    if unavailable.is_empty() {
        Ok(selected)
    } else {
        Err(format!("unknown adapter: {}", unavailable.join(", ")).into())
    }
}

pub fn fixture_arguments(mode: &str, values: &[String]) -> Vec<String> {
    std::iter::once("__fixture".to_string())
        .chain(std::iter::once(mode.to_string()))
        .chain(values.iter().cloned())
        .collect()
}

pub fn benchmark_executable() -> BenchmarkResult<PathBuf> {
    Ok(std::env::current_exe()?)
}
