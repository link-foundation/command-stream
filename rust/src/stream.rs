//! Streaming and async iteration support
//!
//! This module provides async streaming capabilities similar to JavaScript's
//! async iterators and stream handling in `$.stream-utils.mjs`.
//!
//! ## Usage
//!
//! ```rust,no_run
//! use command_stream::{StreamingRunner, OutputChunk};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let runner = StreamingRunner::new("yes hello");
//!
//!     // Stream output as it arrives
//!     let mut stream = runner.stream();
//!     let mut count = 0;
//!     while let Some(chunk) = stream.next().await {
//!         match chunk {
//!             OutputChunk::Stdout(data) => {
//!                 print!("{}", String::from_utf8_lossy(&data));
//!                 count += 1;
//!                 if count >= 5 {
//!                     break;
//!                 }
//!             }
//!             OutputChunk::Stderr(data) => {
//!                 eprint!("{}", String::from_utf8_lossy(&data));
//!             }
//!             OutputChunk::Exit(code) => {
//!                 println!("Process exited with code: {}", code);
//!                 break;
//!             }
//!         }
//!     }
//!
//!     Ok(())
//! }
//! ```

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::trace::trace_lazy;
use crate::{CommandResult, Result};

/// A chunk of output from a streaming process
#[derive(Debug, Clone)]
pub enum OutputChunk {
    /// Stdout data
    Stdout(Vec<u8>),
    /// Stderr data
    Stderr(Vec<u8>),
    /// Process exit code
    Exit(i32),
}

/// A streaming process runner that allows async iteration over output
pub struct StreamingRunner {
    command: String,
    cwd: Option<PathBuf>,
    env: Option<HashMap<String, String>>,
    stdin_content: Option<String>,
}

impl StreamingRunner {
    /// Create a new streaming runner
    pub fn new(command: impl Into<String>) -> Self {
        StreamingRunner {
            command: command.into(),
            cwd: None,
            env: None,
            stdin_content: None,
        }
    }

    /// Set the working directory
    pub fn cwd(mut self, path: impl Into<PathBuf>) -> Self {
        self.cwd = Some(path.into());
        self
    }

    /// Set environment variables
    pub fn env(mut self, env: HashMap<String, String>) -> Self {
        self.env = Some(env);
        self
    }

    /// Set stdin content
    pub fn stdin(mut self, content: impl Into<String>) -> Self {
        self.stdin_content = Some(content.into());
        self
    }

    /// Start the process and return a stream of output chunks
    pub fn stream(mut self) -> OutputStream {
        let (tx, rx) = mpsc::channel(1024);

        // Spawn the process handling task
        let command = self.command.clone();
        let cwd = self.cwd.take();
        let env = self.env.take();
        let stdin_content = self.stdin_content.take();

        tokio::spawn(async move {
            if let Err(e) = run_streaming_process(command, cwd, env, stdin_content, tx.clone()).await {
                trace_lazy("StreamingRunner", || format!("Error: {}", e));
            }
        });

        OutputStream { rx }
    }

    /// Run to completion and collect all output
    pub async fn collect(self) -> Result<CommandResult> {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = 0;

        let mut stream = self.stream();
        while let Some(chunk) = stream.rx.recv().await {
            match chunk {
                OutputChunk::Stdout(data) => stdout.extend(data),
                OutputChunk::Stderr(data) => stderr.extend(data),
                OutputChunk::Exit(code) => exit_code = code,
            }
        }

        Ok(CommandResult {
            stdout: String::from_utf8_lossy(&stdout).to_string(),
            stderr: String::from_utf8_lossy(&stderr).to_string(),
            code: exit_code,
        })
    }
}

/// Stream of output chunks from a process
pub struct OutputStream {
    rx: mpsc::Receiver<OutputChunk>,
}

impl OutputStream {
    /// Receive the next chunk
    pub async fn next(&mut self) -> Option<OutputChunk> {
        self.rx.recv().await
    }

    /// Collect all remaining output into vectors
    pub async fn collect(mut self) -> (Vec<u8>, Vec<u8>, i32) {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = 0;

        while let Some(chunk) = self.rx.recv().await {
            match chunk {
                OutputChunk::Stdout(data) => stdout.extend(data),
                OutputChunk::Stderr(data) => stderr.extend(data),
                OutputChunk::Exit(code) => exit_code = code,
            }
        }

        (stdout, stderr, exit_code)
    }

    /// Collect stdout only, discarding stderr
    pub async fn collect_stdout(mut self) -> Vec<u8> {
        let mut stdout = Vec::new();

        while let Some(chunk) = self.rx.recv().await {
            if let OutputChunk::Stdout(data) = chunk {
                stdout.extend(data);
            }
        }

        stdout
    }
}

/// Run a streaming process and send output to the channel
async fn run_streaming_process(
    command: String,
    cwd: Option<PathBuf>,
    env: Option<HashMap<String, String>>,
    stdin_content: Option<String>,
    tx: mpsc::Sender<OutputChunk>,
) -> Result<()> {
    trace_lazy("StreamingRunner", || format!("Starting: {}", command));

    let shell = find_available_shell();
    let mut cmd = Command::new(&shell.cmd);
    for arg in &shell.args {
        cmd.arg(arg);
    }
    cmd.arg(&command);

    // Configure stdio
    if stdin_content.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Set working directory
    if let Some(ref cwd) = cwd {
        cmd.current_dir(cwd);
    }

    // Set environment
    if let Some(ref env_vars) = env {
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
    }

    // Spawn the process
    let mut child = cmd.spawn()?;

    // Write stdin if needed
    if let Some(content) = stdin_content {
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(content.as_bytes()).await;
            let _ = stdin.shutdown().await;
        }
    }

    // Spawn stdout reader
    let stdout = child.stdout.take();
    let tx_stdout = tx.clone();
    let stdout_handle = if let Some(stdout) = stdout {
        Some(tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut buf = vec![0u8; 8192];
            loop {
                use tokio::io::AsyncReadExt;
                match reader.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_stdout.send(OutputChunk::Stdout(buf[..n].to_vec())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }))
    } else {
        None
    };

    // Spawn stderr reader
    let stderr = child.stderr.take();
    let tx_stderr = tx.clone();
    let stderr_handle = if let Some(stderr) = stderr {
        Some(tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buf = vec![0u8; 8192];
            loop {
                use tokio::io::AsyncReadExt;
                match reader.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_stderr.send(OutputChunk::Stderr(buf[..n].to_vec())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }))
    } else {
        None
    };

    // Wait for readers to complete
    if let Some(handle) = stdout_handle {
        let _ = handle.await;
    }
    if let Some(handle) = stderr_handle {
        let _ = handle.await;
    }

    // Wait for process to exit
    let status = child.wait().await?;
    let code = status.code().unwrap_or(-1);

    // Send exit code
    let _ = tx.send(OutputChunk::Exit(code)).await;

    trace_lazy("StreamingRunner", || format!("Exited with code: {}", code));

    Ok(())
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

/// Async iterator trait for output streams
#[async_trait::async_trait]
pub trait AsyncIterator {
    type Item;

    /// Get the next item from the iterator
    async fn next(&mut self) -> Option<Self::Item>;
}

#[async_trait::async_trait]
impl AsyncIterator for OutputStream {
    type Item = OutputChunk;

    async fn next(&mut self) -> Option<Self::Item> {
        self.rx.recv().await
    }
}

/// Extension trait to convert ProcessRunner into a stream
pub trait IntoStream {
    /// Convert into an output stream
    fn into_stream(self) -> OutputStream;
}

impl IntoStream for crate::ProcessRunner {
    fn into_stream(self) -> OutputStream {
        let streaming = StreamingRunner::new(self.command().to_string());
        streaming.stream()
    }
}
