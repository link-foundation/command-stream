#[cfg(not(windows))]
use super::support::fixture_path;
use super::support::{decode_hex_lines, fixture_runner, hex, run_fixture, shell_fixture_command};
#[cfg(not(windows))]
use command_stream::cmd;
use command_stream::{run_sync, OutputChunk, Pipeline, StreamingRunner};
use std::collections::HashMap;
use std::ffi::OsString;
use std::time::Duration;

const COMPLEX_MARKDOWN_ARGUMENT: &str = r##"## Bug description

Passing Markdown through `gh issue create --body` must preserve:

- fenced code blocks:
```rust
let message = format!("literal ${value}");
```
- shell-looking text: $HOME ${USER} $(whoami) `date`
- quotes and operators: "double" 'single' && || ; | > < * ? [abc] {one,two}
- whitespace: leading,  repeated, tabs\t, and newlines
- backslashes and paths: C:\Program Files\command-stream\
- Unicode: snow 雪, rocket 🚀, and café

Nothing above is shell syntax."##;

pub const BEHAVIOR_CASE_IDS: &[&str] = &[
    "direct-exact-argv",
    "argument-edge-cases",
    "safe-template-interpolation",
    "cwd-string",
    "environment",
    "stdout-stderr-separation",
    "newline-preservation",
    "unicode-output",
    "large-output",
    "nonzero-exit",
    "stdin-string",
    "lazy-execution",
    "concurrent-execution",
    "streamed-before-exit",
    "sync-execution",
    "programmatic-pipeline",
    "spawn-error-propagation",
    "stream-kill",
];

#[tokio::test]
async fn direct_exact_argv_preserves_argument_boundaries() {
    let expected = ["plain", "two words", "--flag=value", "trailing\\"];
    let result = run_fixture("argv", &expected).await;

    assert_eq!(result.code, 0);
    assert_eq!(decode_hex_lines(&result.stdout), expected);
}

#[tokio::test]
async fn argument_edge_cases_reach_the_child_verbatim() {
    let expected = [
        "",
        " ",
        "line one\nline two",
        "tab\tvalue",
        "Iñtërnâtiônàlizætiøn☃",
        "\"double\" and 'single'",
        "$HOME",
        "$(echo injected)",
        "&&",
        "|",
        ";",
        "*",
        "?",
        COMPLEX_MARKDOWN_ARGUMENT,
    ];
    let result = run_fixture("argv", &expected).await;

    assert_eq!(result.code, 0);
    assert_eq!(decode_hex_lines(&result.stdout), expected);
}

#[cfg(not(windows))]
#[tokio::test]
async fn safe_template_interpolation_is_one_literal_argument() {
    let executable = fixture_path().display();
    let values = [
        "'; echo injected; echo '$HOME $(uname) *",
        COMPLEX_MARKDOWN_ARGUMENT,
    ];

    for value in values {
        let result = cmd!("{} argv {}", executable, value).await.unwrap();

        assert_eq!(result.code, 0);
        assert_eq!(decode_hex_lines(&result.stdout), [value]);
    }
}

#[tokio::test]
async fn cwd_string_starts_the_child_in_that_directory() {
    let directory = tempfile::tempdir().unwrap();
    let result = fixture_runner("cwd", &[])
        .cwd(directory.path())
        .collect()
        .await
        .unwrap();

    assert_eq!(result.code, 0);
    assert_eq!(
        std::fs::canonicalize(result.stdout).unwrap(),
        std::fs::canonicalize(directory.path()).unwrap()
    );
}

#[tokio::test]
async fn environment_passes_explicit_values_to_the_child() {
    let mut environment = HashMap::new();
    environment.insert("COMMAND_STREAM_CORPUS_ALPHA".into(), "one".into());
    environment.insert("COMMAND_STREAM_CORPUS_UNICODE".into(), "héllø☃".into());
    let result = fixture_runner(
        "env",
        &[
            "COMMAND_STREAM_CORPUS_ALPHA",
            "COMMAND_STREAM_CORPUS_UNICODE",
        ],
    )
    .env(environment)
    .collect()
    .await
    .unwrap();

    assert_eq!(decode_hex_lines(&result.stdout), ["one", "héllø☃"]);
}

#[tokio::test]
async fn stdout_and_stderr_are_captured_separately() {
    for (stdout, stderr) in [
        ("out-value", "err-value"),
        ("out-only", ""),
        // A successful CLI may use stderr for machine-readable output. gh pr
        // create was reported to do this for its URL in issue #47.
        ("", "https://github.com/octo/example/pull/123\n"),
    ] {
        let result = run_fixture("output", &[stdout, stderr]).await;

        assert_eq!(result.code, 0);
        assert_eq!(result.stdout, stdout);
        assert_eq!(result.stderr, stderr);
    }
}

#[tokio::test]
async fn newline_preservation_keeps_final_and_repeated_newlines() {
    let result = run_fixture("output", &["first\n\nthird\n", ""]).await;

    assert_eq!(result.stdout, "first\n\nthird\n");
}

#[tokio::test]
async fn unicode_output_is_not_lost() {
    let expected = "Iñtërnâtiônàlizætiøn☃ 東京 🦀";
    let result = run_fixture("output", &[expected, ""]).await;

    assert_eq!(result.stdout, expected);
}

#[tokio::test]
async fn large_output_is_not_truncated_or_deadlocked() {
    const SIZE: usize = 1024 * 1024;
    let result = tokio::time::timeout(
        Duration::from_secs(15),
        run_fixture("large", &[&SIZE.to_string()]),
    )
    .await
    .expect("large output should not deadlock");

    assert_eq!(result.code, 0);
    assert_eq!(result.stdout.len(), SIZE);
    assert!(result.stdout.bytes().all(|byte| byte == b'x'));
}

#[tokio::test]
async fn nonzero_exit_is_returned_as_a_result() {
    let result = run_fixture("exit", &["23"]).await;

    assert_eq!(result.code, 23);
    assert!(!result.is_success());
}

#[tokio::test]
async fn stdin_string_is_written_and_closed() {
    let input = "first line\nIñtërnâtiônàlizætiøn☃\n";
    let result = fixture_runner("stdin", &[])
        .stdin(input)
        .collect()
        .await
        .unwrap();

    assert_eq!(result.code, 0);
    assert_eq!(result.stdout, hex(input));
}

#[tokio::test]
async fn runner_is_lazy_until_consumed() {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("spawned.txt");
    let runner = fixture_runner("touch", &[marker.to_str().unwrap()]);

    assert!(!marker.exists());
    let result = runner.collect().await.unwrap();
    assert_eq!(result.code, 0);
    assert_eq!(std::fs::read(marker).unwrap(), b"spawned");
}

#[tokio::test]
async fn concurrent_results_remain_isolated() {
    let first = fixture_runner("delayed", &["alpha", "40", "-done"]).collect();
    let second = fixture_runner("delayed", &["beta", "10", "-done"]).collect();
    let (first, second) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(first, second)
    })
    .await
    .expect("concurrent commands should finish");

    assert_eq!(first.unwrap().stdout, "alpha-done");
    assert_eq!(second.unwrap().stdout, "beta-done");
}

#[tokio::test]
async fn output_streams_before_the_child_exits() {
    let mut stream = fixture_runner("delayed", &["first", "250", "second"]).stream();
    let first = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("first output should arrive before exit")
        .expect("stream should contain output");

    match first {
        OutputChunk::Stdout(data) => assert_eq!(data, b"first"),
        other => panic!("expected stdout before exit, got {other:?}"),
    }

    let (stdout, stderr, code) = stream.collect().await;
    assert_eq!(stdout, b"second");
    assert!(stderr.is_empty());
    assert_eq!(code, 0);
}

#[test]
fn sync_execution_returns_the_same_captured_result() {
    let command = shell_fixture_command("output", &["sync-out", "sync-err"]);
    let result = run_sync(command).unwrap();

    assert_eq!(result.code, 0);
    assert_eq!(result.stdout, "sync-out");
    assert_eq!(result.stderr, "sync-err");
}

#[tokio::test]
async fn programmatic_pipeline_connects_stdout_to_stdin() {
    let first = shell_fixture_command("prefix", &["left-"]);
    let second = shell_fixture_command("prefix", &["right-"]);
    let result = Pipeline::new()
        .stdin("value")
        .add(first)
        .add(second)
        .mirror_output(false)
        .run()
        .await
        .unwrap();

    assert_eq!(result.code, 0);
    assert_eq!(result.stdout, "right-left-value");
}

#[tokio::test]
async fn spawn_error_is_propagated_by_collect() {
    let missing = format!(
        "command-stream-definitely-missing-{}{}",
        std::process::id(),
        std::env::consts::EXE_SUFFIX
    );
    let error = tokio::time::timeout(
        Duration::from_secs(5),
        StreamingRunner::from_argv(OsString::from(missing), Vec::<OsString>::new()).collect(),
    )
    .await
    .expect("missing executable should resolve promptly")
    .expect_err("missing executable must not look like a successful command");

    assert!(error.to_string().contains("IO error"));
}

#[tokio::test]
async fn stream_kill_stops_a_running_child() {
    let mut stream = fixture_runner("delayed", &["started", "10000", "too-late"]).stream();
    let first = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("child should start")
        .expect("child should emit stdout");
    assert!(matches!(first, OutputChunk::Stdout(ref data) if data == b"started"));

    stream.kill();
    let mut exit = None;
    tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(chunk) = stream.next().await {
            if let OutputChunk::Exit(code) = chunk {
                exit = Some(code);
            }
        }
    })
    .await
    .expect("killed process should terminate promptly");

    assert_eq!(exit, Some(143));
}
