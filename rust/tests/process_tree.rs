//! Descendant termination on Windows, macOS and Linux (issue #205).
use command_stream::{OutputChunk, ProcessRunner, RunOptions, StdinOption, StreamingRunner};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

fn fixture() -> &'static Path {
    static FIXTURE: OnceLock<(tempfile::TempDir, PathBuf)> = OnceLock::new();
    &FIXTURE
        .get_or_init(|| {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(if cfg!(windows) {
                "tree-heartbeat.exe"
            } else {
                "tree-heartbeat"
            });
            let status = std::process::Command::new("rustc")
                .arg(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../experiments/issue-205/tree-heartbeat.rs"
                ))
                .arg("-o")
                .arg(&path)
                .status()
                .unwrap();
            assert!(status.success());
            (directory, path)
        })
        .1
}

struct Heartbeat(tempfile::TempDir);

impl Heartbeat {
    fn path(&self) -> PathBuf {
        self.0.path().join("heartbeat")
    }

    fn len(&self) -> u64 {
        std::fs::metadata(self.path()).map(|m| m.len()).unwrap_or(0)
    }

    async fn ready(&self) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while self.len() == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("fixture did not start writing");
    }

    async fn assert_stopped(&self) {
        assert!(
            self.len() > 0,
            "a descendant must have run before cancellation"
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
        let before = self.len();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            self.len(),
            before,
            "descendant kept writing after cancellation"
        );
    }
}

impl Drop for Heartbeat {
    fn drop(&mut self) {
        let Ok(text) = std::fs::read_to_string(self.path().with_extension("pid")) else {
            return;
        };
        let Ok(pid) = text.parse::<u32>() else {
            return;
        };
        #[cfg(unix)]
        {
            use nix::{
                sys::signal::{kill, Signal},
                unistd::Pid,
            };
            let _ = kill(Pid::from_raw(pid as i32), Signal::SIGKILL);
        }
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output();
        }
    }
}

#[tokio::test]
async fn process_runner_kill_stops_descendants() {
    let heartbeat = Heartbeat(tempfile::tempdir().unwrap());
    let command = format!(
        "{} parent {}",
        command_stream::quote(&fixture().to_string_lossy()),
        command_stream::quote(&heartbeat.path().to_string_lossy()),
    );
    let mut runner = ProcessRunner::new(
        command,
        RunOptions {
            mirror: false,
            stdin: StdinOption::Null,
            ..Default::default()
        },
    );
    runner.start().await.unwrap();
    heartbeat.ready().await;
    runner.kill().unwrap();
    tokio::time::timeout(Duration::from_secs(3), runner.run())
        .await
        .expect("cancelled runner did not finish")
        .unwrap();
    heartbeat.assert_stopped().await;
}

async fn streaming_kill_stops_descendants(grace: u64, abandon: bool) {
    let heartbeat = Heartbeat(tempfile::tempdir().unwrap());
    let runner = StreamingRunner::from_argv(
        fixture(),
        [
            std::ffi::OsString::from("parent"),
            heartbeat.path().into_os_string(),
        ],
    )
    .kill_grace_ms(grace);
    let mut stream = runner.stream();
    heartbeat.ready().await;
    if abandon {
        drop(stream);
        // Drop schedules cancellation on the runner's background task.
        tokio::time::sleep(Duration::from_millis(750)).await;
    } else {
        stream.kill();
        let exit = tokio::time::timeout(Duration::from_secs(3), async {
            while let Some(chunk) = stream.next().await {
                if let OutputChunk::Exit(code) = chunk {
                    return code;
                }
            }
            panic!("stream ended without an exit code");
        })
        .await
        .expect("cancelled stream did not finish");
        assert_eq!(exit, 143);
    }
    heartbeat.assert_stopped().await;
}

#[tokio::test]
async fn stream_kill_stops_descendants() {
    streaming_kill_stops_descendants(100, false).await;
}

#[tokio::test]
async fn stream_zero_grace_stops_descendants() {
    streaming_kill_stops_descendants(0, false).await;
}

#[tokio::test]
async fn dropping_stream_stops_descendants() {
    streaming_kill_stops_descendants(100, true).await;
}
