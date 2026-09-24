use command_stream::{exec, RunOptions};

#[tokio::test]
async fn executes_boolean_and_sequence_operators() {
    let result = exec(
        "false || echo fallback; echo next",
        RunOptions {
            mirror: false,
            ..RunOptions::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(result.stdout, "fallback\nnext\n");
    assert_eq!(result.code, 0);
}
