//! Tests for the streaming module

use command_stream::{StreamingRunner, OutputChunk, AsyncIterator};

#[tokio::test]
async fn test_streaming_runner_basic() {
    let runner = StreamingRunner::new("echo hello world");
    let result = runner.collect().await.unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("hello world"));
}

#[tokio::test]
async fn test_streaming_runner_with_stdin() {
    let runner = StreamingRunner::new("cat")
        .stdin("test input");
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
    let runner = StreamingRunner::new("pwd")
        .cwd("/tmp");
    let result = runner.collect().await.unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("/tmp"));
}

#[tokio::test]
async fn test_streaming_runner_env() {
    use std::collections::HashMap;

    let mut env = HashMap::new();
    env.insert("TEST_VAR".to_string(), "test_value".to_string());

    let runner = StreamingRunner::new("sh -c 'echo $TEST_VAR'")
        .env(env);
    let result = runner.collect().await.unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("test_value"));
}
