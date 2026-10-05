use command_stream::{ProcessRunner, RunOptions, StdinOption};

#[tokio::test]
async fn writes_to_a_running_commands_stdin() {
    let mut runner = ProcessRunner::new(
        "cat",
        RunOptions {
            mirror: false,
            stdin: StdinOption::Pipe,
            ..RunOptions::default()
        },
    );

    runner.start().await.unwrap();
    runner.write_stdin("first line\n").await.unwrap();
    runner.write_stdin("second line\n").await.unwrap();
    runner.close_stdin().await.unwrap();

    let result = runner.run().await.unwrap();
    assert_eq!(result.stdout, "first line\nsecond line\n");
    assert_eq!(result.stdin.to_string(), "first line\nsecond line\n");
}
