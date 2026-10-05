use command_stream::{exec, RunOptions, StdinOption};
use std::io::{Read, Write};

#[tokio::test]
async fn completed_result_exposes_streams() {
    let options = RunOptions {
        stdin: StdinOption::Content("input".to_string()),
        mirror: false,
        ..RunOptions::default()
    };
    let mut result = exec("cat", options).await.unwrap();
    let mut stdout = String::new();
    result.stdout.read_to_string(&mut stdout).unwrap();
    assert_eq!(stdout, "input");
    let mut stderr = String::new();
    result.stderr.read_to_string(&mut stderr).unwrap();
    assert!(stderr.is_empty());
    result.stdin.write_all(b"more").unwrap();
    assert_eq!(result.stdin.to_string(), "inputmore");
    result.stdout.rewind();
    let mut replay = String::new();
    result.stdout.read_to_string(&mut replay).unwrap();
    assert_eq!(replay, "input");
}

#[tokio::test]
async fn streaming_runner_records_input_in_completed_result() {
    let result = command_stream::StreamingRunner::new("cat")
        .stdin("streamed")
        .collect()
        .await
        .unwrap();
    assert_eq!(result.stdout, "streamed");
    assert_eq!(result.stdin.to_string(), "streamed");
}
