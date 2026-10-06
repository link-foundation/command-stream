#[path = "execa/support.rs"]
mod support;

use command_stream::execa::{self, Cancellation, Execa, Options};
use std::collections::HashMap;
use std::time::Duration;

#[tokio::test]
async fn direct_arguments_survive_without_shell_evaluation() {
    let values = [
        "",
        "a b",
        "\"",
        "'",
        "\\",
        "$HOME",
        ";",
        "|",
        "*",
        "日本語",
        "one\ntwo",
    ];
    let mut args = vec!["argv"];
    args.extend(values);
    let result = execa::execa(support::fixture(), args).await.unwrap();
    assert_eq!(result.text(), format!("{values:?}"));
    assert_eq!(result.exit_code, Some(0));
    assert!(!result.failed);
}

#[tokio::test]
async fn general_api_has_the_same_defaults_as_the_isolated_module() {
    let result = command_stream::execa(support::fixture(), ["output", "hello\n"])
        .await
        .unwrap();
    assert_eq!(result.text(), "hello");
    let api = command_stream::execa_compat(Options {
        strip_final_newline: false,
        ..Options::default()
    });
    assert_eq!(
        api.command(support::fixture(), ["output", "hello\n"])
            .await
            .unwrap()
            .text(),
        "hello\n"
    );
}

#[tokio::test]
async fn binary_input_is_preserved_and_stdin_closes() {
    let data = vec![0, 10, 13, 255, 128];
    let result = execa::execa(support::fixture(), ["input"])
        .input(data.clone())
        .strip_final_newline(false)
        .await
        .unwrap();
    assert_eq!(result.stdout, data);
}

#[tokio::test]
async fn output_defaults_match_execa_and_all_is_opt_in() {
    let result = execa::execa(support::fixture(), ["output", "a\r\n\r\n", "err\n"])
        .await
        .unwrap();
    assert_eq!(result.text(), "a\r\n");
    assert_eq!(result.stderr_text(), "err");
    assert_eq!(result.stdout_lines(), ["a", ""]);
    assert_eq!(result.all, None);
    let result = execa::execa(support::fixture(), ["output", "out", "err"])
        .all(true)
        .await
        .unwrap();
    let all = String::from_utf8(result.all.unwrap()).unwrap();
    assert!(all.contains("out") && all.contains("err"));
}

#[tokio::test]
async fn failures_reject_unless_requested_and_keep_structured_status() {
    let error = execa::execa(support::fixture(), ["exit", "42"])
        .await
        .unwrap_err();
    assert_eq!(error.result.exit_code, Some(42));
    assert!(error.result.failed);
    assert!(error.to_string().contains("42"));
    let result = execa::execa(support::fixture(), ["exit", "143"])
        .reject(false)
        .await
        .unwrap();
    assert_eq!(result.exit_code, Some(143));
    assert_eq!(result.signal, None);
}

#[tokio::test]
async fn spawn_errors_do_not_invent_an_exit_code() {
    let error = execa::execa("command-stream-execa-missing-command-24", [""])
        .await
        .unwrap_err();
    assert_eq!(error.result.exit_code, None);
    assert!(error.result.failed);
    assert!(error.result.cause.is_some());
}

#[tokio::test]
async fn cwd_and_environment_are_per_command() {
    let dir = tempfile::tempdir().unwrap();
    let output = Execa::default()
        .command(support::fixture(), ["cwd"])
        .cwd(dir.path())
        .await
        .unwrap();
    assert_eq!(
        std::fs::canonicalize(output.text()).unwrap(),
        dir.path().canonicalize().unwrap()
    );
    let opts = Options {
        env: HashMap::from([("EXECA_TEST".into(), "literal $ value".into())]),
        extend_env: false,
        ..Options::default()
    };
    let result = Execa::new(opts)
        .command(support::fixture(), ["env", "EXECA_TEST"])
        .await
        .unwrap();
    assert_eq!(result.text(), "literal $ value");
    assert_eq!(
        Execa::new(Options {
            extend_env: false,
            ..Options::default()
        })
        .command(support::fixture(), ["env", "PATH"])
        .await
        .unwrap()
        .text(),
        ""
    );
}

#[tokio::test]
async fn live_output_is_available_before_the_child_finishes() {
    let mut child = execa::execa(support::fixture(), ["delayed"]).spawn();
    let first = child.next().await.unwrap();
    assert!(matches!(first, command_stream::OutputChunk::Stdout(data) if data == b"started\n"));
    assert!(child.pid().is_some());
    let result = child.wait().await.unwrap();
    assert_eq!(result.text(), "started\nfinished");
}

#[tokio::test]
async fn buffer_false_streams_without_capturing() {
    let mut child = execa::execa(support::fixture(), ["output", "streamed"])
        .buffer(false)
        .spawn();
    let mut bytes = Vec::new();
    while let Some(chunk) = child.next().await {
        if let command_stream::OutputChunk::Stdout(data) = chunk {
            bytes.extend(data);
        }
    }
    assert_eq!(bytes, b"streamed");
    assert!(child.wait().await.unwrap().stdout.is_empty());
}

#[tokio::test]
async fn timeout_cancellation_and_kill_report_their_reason() {
    let result = execa::execa(support::fixture(), ["wait"])
        .timeout(Duration::from_millis(50))
        .reject(false)
        .await
        .unwrap();
    assert!(result.timed_out && result.failed && result.killed);
    assert!(result.signal.is_some());
    assert_eq!(result.exit_code, None);
    let cancellation = Cancellation::new();
    let mut child = execa::execa(support::fixture(), ["delayed"])
        .cancel_signal(cancellation.signal())
        .reject(false)
        .spawn();
    child.next().await.unwrap();
    cancellation.cancel();
    assert!(child.wait().await.unwrap().is_canceled);
    let mut child = execa::execa(support::fixture(), ["delayed"])
        .reject(false)
        .spawn();
    child.next().await.unwrap();
    child.kill("SIGTERM");
    assert!(child.wait().await.unwrap().killed);
}

#[tokio::test]
async fn max_buffer_caps_both_streams_and_marks_overflow() {
    let result = execa::execa(support::fixture(), ["duplex"])
        .input(vec![b'i'; 262_144])
        .max_buffer(128)
        .reject(false)
        .await
        .unwrap();
    assert!(result.is_max_buffer && result.failed);
    assert!(result.stdout.len() <= 128);
}

#[tokio::test]
async fn pipe_preserves_source_failure_and_transfers_stdout() {
    let result = execa::execa(support::fixture(), ["output", "hello\n"])
        .pipe(execa::execa(support::fixture(), ["input"]))
        .await
        .unwrap();
    assert_eq!(result.text(), "hello");
    let error = execa::execa(support::fixture(), ["exit", "42"])
        .pipe(execa::execa(support::fixture(), ["input"]))
        .await
        .unwrap_err();
    assert_eq!(error.result.exit_code, Some(42));
}

#[test]
fn sync_runs_the_same_exact_argv_and_error_rules() {
    let result = execa::execa(support::fixture(), ["argv", "a b", "$HOME"])
        .sync()
        .unwrap();
    assert_eq!(result.text(), "[\"a b\", \"$HOME\"]");
    assert_eq!(
        execa::execa(support::fixture(), ["exit", "7"])
            .sync()
            .unwrap_err()
            .result
            .exit_code,
        Some(7)
    );
}

#[tokio::test]
async fn node_factory_uses_configured_executable_options_and_exact_argv() {
    let api = Execa::new(Options {
        node_exec_path: support::fixture().into_os_string(),
        node_options: vec!["argv".into()],
        ..Options::default()
    });
    let result = api
        .node("script with spaces.js", ["hello world", "$HOME"])
        .await
        .unwrap();
    assert_eq!(
        result.text(),
        "[\"script with spaces.js\", \"hello world\", \"$HOME\"]"
    );
}

#[tokio::test]
async fn already_canceled_commands_are_stopped_and_sync_rejects_inside_tokio() {
    let cancellation = Cancellation::new();
    cancellation.cancel();
    let result = execa::execa(support::fixture(), ["wait"])
        .cancel_signal(cancellation.signal())
        .reject(false)
        .await
        .unwrap();
    assert!(result.is_canceled);
    let error = command_stream::execa_sync(support::fixture(), ["argv"]).unwrap_err();
    assert!(error.result.cause.unwrap().contains("inside Tokio"));
}

#[tokio::test]
async fn buffered_pipe_also_works_when_source_capture_was_disabled() {
    let result = execa::execa(support::fixture(), ["output", "hello\n"])
        .buffer(false)
        .pipe(execa::execa(support::fixture(), ["input"]))
        .await
        .unwrap();
    assert_eq!(result.text(), "hello");
}
