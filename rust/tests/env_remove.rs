//! Regression tests for issue #229: a single inherited environment variable
//! can be removed from the child, the `env -u NAME` equivalent.
#![cfg(unix)]

use command_stream::{ProcessRunner, RunOptions, StreamingRunner};
use std::collections::HashMap;

/// A variable inherited by every child of this test process. Each test uses
/// its own name, since tests share the process environment.
fn inherited(name: &str) -> String {
    std::env::set_var(name, "inherited-value");
    name.to_string()
}

#[tokio::test]
async fn streaming_runner_env_remove_drops_an_inherited_variable() {
    let name = inherited("COMMAND_STREAM_ENV_REMOVE_STREAM");
    let kept = StreamingRunner::from_argv("printenv", [&name])
        .collect()
        .await
        .unwrap();
    assert_eq!(kept.stdout, "inherited-value\n");

    let removed = StreamingRunner::from_argv("printenv", [&name])
        .env_remove(&name)
        .collect()
        .await
        .unwrap();
    assert_eq!(removed.stdout, "");
    assert_eq!(removed.code, 1, "printenv exits 1 for a missing variable");
}

#[tokio::test]
async fn streaming_runner_env_remove_wins_over_env() {
    let name = inherited("COMMAND_STREAM_ENV_REMOVE_OVERRIDE");
    let other = "COMMAND_STREAM_ENV_REMOVE_KEPT".to_string();
    let env = HashMap::from([
        (name.clone(), "explicit".to_string()),
        (other.clone(), "kept".to_string()),
    ]);
    let result = StreamingRunner::new(format!("echo \"${{{name}-unset}} ${{{other}-unset}}\""))
        .env(env)
        .env_remove_all([name.as_str()])
        .collect()
        .await
        .unwrap();

    assert_eq!(result.stdout, "unset kept\n");
}

#[tokio::test]
async fn run_options_env_remove_drops_an_inherited_variable() {
    let name = inherited("COMMAND_STREAM_ENV_REMOVE_RUNNER");
    let mut runner = ProcessRunner::new(
        format!("echo \"${{{name}-unset}}\""),
        RunOptions {
            mirror: false,
            env_remove: vec![name.clone()],
            ..Default::default()
        },
    );
    let result = runner.run().await.unwrap();

    assert_eq!(result.stdout, "unset\n");
}

#[tokio::test]
async fn run_options_env_remove_reaches_the_env_command() {
    // `env` is also a built-in; the removal must not be lost to it.
    let name = inherited("COMMAND_STREAM_ENV_REMOVE_BUILTIN");
    let mut runner = ProcessRunner::new(
        "env",
        RunOptions {
            mirror: false,
            env_remove: vec![name.clone()],
            ..Default::default()
        },
    );
    let result = runner.run().await.unwrap();

    assert!(result.stdout.contains("PATH="));
    assert!(!result.stdout.contains(&name), "{}", result.stdout);
}
