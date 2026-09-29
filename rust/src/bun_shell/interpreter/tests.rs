use std::collections::HashMap;

use super::*;
use crate::bun_shell::{shell, OutBuffer, ShellErrorKind, ShellOutput};

/// A small, known environment (never the process environment, which may
/// hold credentials).
fn env() -> HashMap<String, String> {
    HashMap::from([
        (
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_default(),
        ),
        ("HOME".to_string(), "/home/me".to_string()),
    ])
}

async fn run(script: &str) -> ShellOutput {
    run_with(&[script], vec![]).await
}

async fn run_with(strings: &[&str], values: Vec<ShellValue>) -> ShellOutput {
    shell(strings, values)
        .unwrap()
        .env(env())
        .quiet()
        .nothrow()
        .run()
        .await
        .unwrap()
}

fn out(stdout: &str, stderr: &str, exit_code: i32) -> ShellOutput {
    ShellOutput {
        stdout: stdout.into(),
        stderr: stderr.into(),
        exit_code,
    }
}

#[tokio::test]
async fn statements_and_logical_operators() {
    assert_eq!(run("echo a; echo b").await, out("a\nb\n", "", 0));
    assert_eq!(run("false && echo no").await, out("", "", 1));
    assert_eq!(run("false || echo yes").await, out("yes\n", "", 0));
    assert_eq!(run("true && false || echo c").await, out("c\n", "", 0));
    // A statement's code is its last expression's.
    assert_eq!(run("false; true").await.exit_code, 0);
}

#[tokio::test]
async fn pipelines_use_the_last_exit_code() {
    assert_eq!(run("echo hi | false").await.exit_code, 1);
    assert_eq!(run("false | true").await.exit_code, 0);
    assert_eq!(run("seq 1 3 | echo done").await, out("done\n", "", 0));
}

#[tokio::test]
async fn assignments_and_subshells() {
    assert_eq!(run("A=1; echo $A").await, out("1\n", "", 0));
    assert_eq!(
        run("A=1; (A=2; echo $A); echo $A").await,
        out("2\n1\n", "", 0)
    );
    assert_eq!(run("(exit 3)").await.exit_code, 3);
    assert_eq!(run("echo $(echo in)side").await, out("inside\n", "", 0));
}

#[tokio::test]
async fn if_clauses_and_conditions() {
    let script = "if false; then echo a; elif [[ x == x ]]; then echo b; else echo c; fi";
    assert_eq!(run(script).await, out("b\n", "", 0));
    assert_eq!(run("[[ -z '' ]]").await.exit_code, 0);
    assert_eq!(run("[[ -n '' ]]").await.exit_code, 1);
    assert_eq!(run("[[ a != a ]]").await.exit_code, 1);
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path().to_string_lossy().into_owned();
    let o = run_with(
        &["[[ -d ", " ]] && [[ -f ", " ]]"],
        vec![d.clone().into(), d.into()],
    )
    .await;
    assert_eq!(o.exit_code, 1);
}

#[tokio::test]
async fn command_not_found_and_exit() {
    let o = run("definitely-not-a-command-xyz").await;
    assert_eq!(
        o,
        out(
            "",
            "bun: command not found: definitely-not-a-command-xyz\n",
            1
        )
    );
    // Like Bun, `exit` sets the code but later statements still run.
    assert_eq!(run("exit 7 && echo no").await, out("", "", 7));
    assert_eq!(run("exit 7; echo b").await, out("b\n", "", 0));
}

#[tokio::test]
async fn redirects_to_files_and_buffers() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("out.txt");
    let f = file.to_string_lossy().into_owned();
    let o = run_with(
        &["echo one > ", " && echo two >> ", ""],
        vec![f.clone().into(), f.into()],
    )
    .await;
    assert_eq!(o.exit_code, 0);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "one\ntwo\n");

    let buf = OutBuffer::new(4);
    let o = run_with(&["echo hi > ", ""], vec![buf.clone().into()]).await;
    assert_eq!(o, out("", "", 0));
    assert_eq!(buf.contents(), b"hi\n\0");

    assert_eq!(run("echo err 1>&2").await, out("", "err\n", 0));
}

#[tokio::test]
async fn throwing_mode_and_cwd_errors() {
    let e = shell(&["false"], vec![])
        .unwrap()
        .env(env())
        .quiet()
        .run()
        .await
        .unwrap_err();
    assert_eq!(e.kind, ShellErrorKind::Exit);
    assert_eq!(e.message, "Failed with exit code 1");
    assert_eq!(e.exit_code(), Some(1));

    let e = shell(&["echo hi"], vec![])
        .unwrap()
        .env(env())
        .cwd("/definitely/not/a/dir")
        .quiet()
        .run()
        .await
        .unwrap_err();
    assert_eq!(e.kind, ShellErrorKind::System);
}

#[tokio::test]
async fn join_all_keeps_input_order() {
    let futs: Vec<BoxFut<'_, i32>> = vec![
        Box::pin(async {
            tokio::task::yield_now().await;
            1
        }),
        Box::pin(async { 2 }),
    ];
    assert_eq!(join_all(futs).await, [1, 2]);
}
