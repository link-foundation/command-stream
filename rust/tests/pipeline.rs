//! Tests for the Pipeline module

use command_stream::{Pipeline, PipelineExt, ProcessRunner, RunOptions};

#[tokio::test]
async fn test_pipeline_simple() {
    let result = Pipeline::new()
        .add("echo hello world")
        .run()
        .await
        .unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("hello world"));
}

#[tokio::test]
async fn test_pipeline_two_commands() {
    let result = Pipeline::new()
        .add("echo 'hello\nworld\nhello again'")
        .add("grep hello")
        .run()
        .await
        .unwrap();

    assert!(result.is_success());
    // The grep should filter to only lines containing "hello"
    assert!(result.stdout.contains("hello"));
}

#[tokio::test]
async fn test_pipeline_with_stdin() {
    let result = Pipeline::new()
        .stdin("line1\nline2\nline3")
        .add("cat")
        .run()
        .await
        .unwrap();

    assert!(result.is_success());
    assert!(result.stdout.contains("line1"));
    assert!(result.stdout.contains("line2"));
    assert!(result.stdout.contains("line3"));
}

#[tokio::test]
async fn test_pipeline_three_commands() {
    let result = Pipeline::new()
        .add("echo 'apple\nbanana\napricot\nblueberry'")
        .add("grep a")
        .add("wc -l")
        .run()
        .await
        .unwrap();

    assert!(result.is_success());
    // Should count lines containing 'a': apple, banana, apricot = 3 lines
}

#[tokio::test]
async fn test_pipeline_empty() {
    let result = Pipeline::new().run().await.unwrap();

    // Empty pipeline should return error
    assert!(!result.is_success());
    assert!(result.stderr.contains("No commands"));
}

#[tokio::test]
async fn test_pipeline_failure_propagation() {
    let result = Pipeline::new()
        .add("echo hello")
        .add("false")  // This command always fails
        .add("echo should not reach here")
        .run()
        .await
        .unwrap();

    // Pipeline should fail because 'false' returns non-zero
    assert!(!result.is_success());
}

#[tokio::test]
async fn test_pipeline_builder_pattern() {
    // Test the fluent API
    let pipeline = Pipeline::new()
        .add("echo test")
        .mirror_output(false)
        .capture_output(true);

    let result = pipeline.run().await.unwrap();
    assert!(result.is_success());
}
