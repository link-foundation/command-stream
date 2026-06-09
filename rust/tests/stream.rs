//! Tests for the streaming module

use command_stream::{AsyncIterator, OutputChunk, StreamingRunner};

#[tokio::test]
async fn test_streaming_runner_basic() {
    let runner = StreamingRunner::new("echo hello world");
    let result = runner.collect().await.unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("hello world"));
}

#[tokio::test]
async fn test_streaming_runner_with_stdin() {
    let runner = StreamingRunner::new("cat").stdin("test input");
    let result = runner.collect().await.unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("test input"));
}

#[tokio::test]
async fn test_output_stream_chunks() {
    let runner = StreamingRunner::new("echo chunk1 && echo chunk2");
    let mut stream = runner.stream();

    let mut stdout_chunks = Vec::new();
    let mut exit_code = None;

    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(data) => {
                stdout_chunks.push(String::from_utf8_lossy(&data).to_string());
            }
            OutputChunk::Stderr(_) => {}
            OutputChunk::Exit(code) => {
                exit_code = Some(code);
            }
        }
    }

    assert!(exit_code.is_some());
    assert_eq!(exit_code.unwrap(), 0);
    let combined: String = stdout_chunks.join("");
    assert!(combined.contains("chunk1"));
    assert!(combined.contains("chunk2"));
}

#[tokio::test]
async fn test_streaming_collect_stdout() {
    let runner = StreamingRunner::new("echo stdout only");
    let stream = runner.stream();

    let stdout = stream.collect_stdout().await;
    let stdout_str = String::from_utf8_lossy(&stdout);

    assert!(stdout_str.contains("stdout only"));
}

#[tokio::test]
async fn test_streaming_stderr() {
    // Using sh -c to redirect to stderr
    let runner = StreamingRunner::new("sh -c 'echo error message >&2'");
    let result = runner.collect().await.unwrap();

    assert!(result.stderr.contains("error message"));
}

#[tokio::test]
async fn test_streaming_exit_code() {
    let runner = StreamingRunner::new("exit 42");
    let result = runner.collect().await.unwrap();

    assert_eq!(result.code, 42);
}

#[tokio::test]
async fn test_streaming_runner_cwd() {
    let temp_dir = tempfile::tempdir().unwrap();
    let command = if cfg!(windows) { "cd" } else { "pwd" };
    let runner = StreamingRunner::new(command).cwd(temp_dir.path());
    let result = runner.collect().await.unwrap();

    assert!(result.is_success());
    let stdout = result.stdout.trim().replace('\\', "/");
    let expected = temp_dir.path().to_string_lossy().replace('\\', "/");
    assert!(
        stdout.contains(&expected),
        "expected stdout {stdout:?} to contain cwd {expected:?}"
    );
}

// --- Regression tests for issue #155 parity with the JavaScript implementation ---

/// The stream must yield an explicit Exit chunk as the final chunk.
#[tokio::test]
async fn test_stream_yields_exit_chunk_last() {
    let runner = StreamingRunner::new("echo hello");
    let mut stream = runner.stream();

    let mut chunks = Vec::new();
    while let Some(chunk) = stream.next().await {
        chunks.push(chunk);
    }

    assert!(!chunks.is_empty());
    let last = chunks.last().unwrap();
    matches!(last, OutputChunk::Exit(0));
    if let OutputChunk::Exit(code) = last {
        assert_eq!(*code, 0);
    } else {
        panic!("last chunk must be an Exit chunk, got {:?}", last);
    }
}

/// The stream must not hang when a grandchild keeps the stdout pipe open after
/// the immediate child has exited.
#[cfg(unix)]
#[tokio::test]
async fn test_stream_does_not_hang_on_open_pipe() {
    use std::time::Instant;

    let start = Instant::now();
    // `sh` exits immediately after `echo done`, but the backgrounded `sleep`
    // inherits the stdout pipe and keeps it open.
    let runner = StreamingRunner::new("sh -c 'sleep 5 & echo done'");
    let mut stream = runner.stream();

    let mut saw_stdout = false;
    let mut saw_exit = false;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(_) => saw_stdout = true,
            OutputChunk::Exit(_) => saw_exit = true,
            _ => {}
        }
    }
    let elapsed = start.elapsed();

    assert!(saw_stdout, "expected stdout output");
    assert!(saw_exit, "expected an exit chunk");
    // Must terminate quickly (grace ~100ms) rather than waiting for the sleep.
    assert!(
        elapsed.as_secs() < 5,
        "stream hung for {:?}; expected prompt termination",
        elapsed
    );
}

/// The process can be stopped from inside the loop with kill(), and the
/// reported exit code follows the configured kill signal.
#[cfg(unix)]
#[tokio::test]
async fn test_stream_kill_from_loop_honors_kill_signal() {
    use std::time::Instant;

    let start = Instant::now();
    // Endless producer.
    let runner = StreamingRunner::new(
        "sh -c 'i=0; while true; do i=$((i+1)); echo line-$i; sleep 0.05; done'",
    )
    .kill_signal("SIGINT");
    let mut stream = runner.stream();

    let mut stdout_count = 0;
    let mut exit_code = None;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(_) => {
                stdout_count += 1;
                if stdout_count >= 3 {
                    stream.kill(); // configured signal => SIGINT
                }
            }
            OutputChunk::Exit(code) => exit_code = Some(code),
            _ => {}
        }
    }
    let elapsed = start.elapsed();

    assert!(stdout_count >= 3);
    assert!(elapsed.as_secs() < 10, "loop did not stop promptly");
    // 128 + SIGINT(2) = 130
    assert_eq!(exit_code, Some(130));
}

/// An explicit kill_with(signal) overrides the configured kill signal.
#[cfg(unix)]
#[tokio::test]
async fn test_stream_kill_with_overrides_configured_signal() {
    let runner =
        StreamingRunner::new("sh -c 'i=0; while true; do i=$((i+1)); echo k-$i; sleep 0.05; done'")
            .kill_signal("SIGINT");
    let mut stream = runner.stream();

    let mut stdout_count = 0;
    let mut exit_code = None;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(_) => {
                stdout_count += 1;
                if stdout_count >= 3 {
                    stream.kill_with("SIGKILL");
                }
            }
            OutputChunk::Exit(code) => exit_code = Some(code),
            _ => {}
        }
    }

    // 128 + SIGKILL(9) = 137
    assert_eq!(exit_code, Some(137));
}

/// Abandoning the stream (dropping it, e.g. after `break`) stops the process.
#[cfg(unix)]
#[tokio::test]
async fn test_stream_break_stops_process() {
    use std::time::Instant;

    let start = Instant::now();
    let runner =
        StreamingRunner::new("sh -c 'i=0; while true; do i=$((i+1)); echo b-$i; sleep 0.05; done'");
    let mut stream = runner.stream();

    let mut count = 0;
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Stdout(_) = chunk {
            count += 1;
            if count >= 3 {
                break; // dropping the stream must terminate the process
            }
        }
    }
    // Drop the stream explicitly to trigger the kill.
    drop(stream);
    let elapsed = start.elapsed();

    assert_eq!(count, 3);
    assert!(
        elapsed.as_secs() < 10,
        "process was not stopped promptly on break"
    );
}

#[tokio::test]
async fn test_streaming_runner_env() {
    use std::collections::HashMap;

    let mut env = HashMap::new();
    env.insert("TEST_VAR".to_string(), "test_value".to_string());

    let runner = StreamingRunner::new("sh -c 'echo $TEST_VAR'").env(env);
    let result = runner.collect().await.unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("test_value"));
}
