#[path = "execa/support.rs"]
mod support;

#[tokio::test]
async fn streamed_stdin_and_stdout_can_both_exceed_a_pipe_buffer() {
    let runner = command_stream::StreamingRunner::from_argv(support::fixture(), ["duplex"])
        .stdin("i".repeat(262_144));
    let result = runner.collect().await.unwrap();
    assert_eq!(
        result.code, 0,
        "the fixture watchdog detected a pipe deadlock"
    );
    assert!(result.stdout.ends_with("262144\n"));
    assert_eq!(result.stdout.len(), 262_144 + 7);
}
