//! Port of the zx `ProcessPromise` unit tests (`test/core.test.js`: pipes,
//! `kill()`, `quiet()`, `verbose()`, `nothrow()`, `timeout()` and the output
//! accessors) for `command_stream::zx`.
#![cfg(unix)]

use std::time::Duration;

use command_stream::zx;
use command_stream::zx::{sleep, tempdir, tempfile, PipeFrom, ProcessOutput, Shell};

/// Unwrap either side of a command result.
fn settled(result: Result<ProcessOutput, ProcessOutput>) -> ProcessOutput {
    result.unwrap_or_else(|e| e)
}

// zx:test/core.test.js:695:7:registration
#[tokio::test]
async fn pipe_accepts_file() {
    let file = tempfile(None, None).unwrap();
    zx!("echo foo").pipe_to_file(&file).await.unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "foo\n");

    let data = std::fs::read(&file).unwrap();
    let r = zx!("cat").input(data).await.unwrap();
    assert_eq!(r.stdout, "foo\n");
    std::fs::remove_file(&file).unwrap();
}

// zx:test/core.test.js:709:7:registration
#[tokio::test]
async fn pipe_accepts_process_promise() {
    let p = zx!("echo foo").pipe(zx!("cat")).await.unwrap();
    assert_eq!(p.stdout.trim(), "foo");
}

// zx:test/core.test.js:750:9:registration
#[tokio::test]
async fn pipe_supports_chaining() {
    let o1 = zx!(r#"echo "hello""#)
        .pipe(zx!(r#"awk '{print $1" world"}'"#))
        .pipe(zx!("tr '[a-z]' '[A-Z]'"))
        .await
        .unwrap();
    assert_eq!(o1.stdout, "HELLO WORLD\n");

    // Attaching a source to an existing pipeline puts it at the head.
    let tail = zx!(r#"awk '{print $1" world"}'"#).pipe(zx!("tr '[a-z]' '[A-Z]'"));
    let o2 = zx!(r#"echo "hello""#).pipe(tail).await.unwrap();
    assert_eq!(o2.stdout, "HELLO WORLD\n");
}

// zx:test/core.test.js:933:7:registration
#[tokio::test]
async fn pipe_propagates_rejection() {
    let quiet = Shell::new().quiet(true);
    let e1 = zx!(quiet.clone(), "exit 1").await.unwrap_err();
    assert_eq!(e1.exit_code, Some(1));
    assert_eq!(e1.stdout, "");

    let e2 = zx!(quiet.clone(), "exit 1")
        .pipe(zx!("echo hello"))
        .await
        .unwrap_err();
    assert_eq!(e2.exit_code, Some(1));
    assert!(!e2.ok());

    let p3 = zx!(quiet.clone().nothrow(true), "echo hello && exit 1")
        .pipe(zx!("cat"))
        .await
        .unwrap();
    assert_eq!(p3.exit_code, Some(0));
    assert_eq!(p3.stdout.trim(), "hello");

    let p5 = zx!(quiet.clone(), "echo bar && sleep 0.1 && exit 1");
    let (r1, r2) = tokio::join!(
        p5.clone().pipe(zx!("cat")).run(),
        p5.pipe(zx!(Shell::new().nothrow(true), "cat")).run(),
    );
    let r1 = r1.unwrap_err();
    assert_eq!(r1.stdout, "bar\n");
    assert_eq!(r1.exit_code, Some(1));
    assert!(!r1.ok());
    let r2 = r2.unwrap();
    assert_eq!(r2.stdout, "bar\n");
    assert_eq!(r2.exit_code, Some(1));
    assert!(!r2.ok());

    let p6 = zx!(quiet, "echo bar && exit 1");
    let (r4, r5) = tokio::join!(
        p6.clone().pipe(zx!("cat")).run(),
        p6.pipe(zx!(Shell::new().nothrow(true), "cat")).run(),
    );
    let r4 = r4.unwrap_err();
    assert_eq!(r4.stdout, "bar\n");
    assert_eq!(r4.exit_code, Some(1));
    let r5 = r5.unwrap();
    assert_eq!(r5.stdout, "bar\n");
    assert_eq!(r5.exit_code, Some(1));
    assert!(!r5.ok());
}

// zx:test/core.test.js:995:7:registration
#[tokio::test]
async fn pipes_particular_stream() {
    let p = zx!(
        Shell::new().quiet(true),
        "echo foo >&2; sleep 0.1 && echo bar"
    );
    let (o1, o2, o3) = tokio::join!(
        p.clone().pipe_stderr(zx!("cat")).run(),
        p.clone().pipe(zx!("cat")).run(),
        p.clone().pipe_stdall(zx!("cat")).run(),
    );
    assert_eq!(o1.unwrap().to_string(), "foo\n");
    assert_eq!(o2.unwrap().to_string(), "bar\n");
    assert_eq!(o3.unwrap().to_string(), "foo\nbar\n");

    let file = tempfile(None, None).unwrap();
    p.pipe_to_file_from(PipeFrom::Stderr, &file).await.unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "foo\n");
    std::fs::remove_file(&file).unwrap();
}

// zx:test/core.test.js:1144:7:registration
#[tokio::test]
async fn kill_just_works() {
    let p = zx!("sleep 999").nothrow().spawn();
    assert!(p.pid().await.is_some());
    sleep(Duration::from_millis(100)).await;
    p.kill(None).unwrap();
    let o = p.wait().await.unwrap();
    assert_eq!(o.signal.as_deref(), Some("SIGTERM"));
    assert!(o.duration >= Duration::from_millis(100));
    assert!(o.duration < Duration::from_millis(1000));
}

// zx:test/core.test.js:1154:7:registration
#[tokio::test]
async fn kill_applies_custom_signal() {
    let p = zx!("while true; do :; done").spawn();
    sleep(Duration::from_millis(100)).await;
    p.kill(Some("SIGKILL")).unwrap();
    let err = p.wait().await.unwrap_err();
    assert_eq!(err.signal.as_deref(), Some("SIGKILL"));
}

// zx:test/core.test.js:1166:7:registration
#[tokio::test]
async fn kill_applies_kill_signal_option() {
    let p = zx!(
        Shell::new().kill_signal("SIGKILL"),
        "while true; do :; done"
    )
    .spawn();
    sleep(Duration::from_millis(100)).await;
    p.kill(None).unwrap();
    let err = p.wait().await.unwrap_err();
    assert_eq!(err.signal.as_deref(), Some("SIGKILL"));

    let bad = zx!("sleep 999").nothrow().spawn();
    assert!(bad.kill(Some("SIGNOPE")).is_err());
    bad.kill(Some("SIGKILL")).unwrap();
    assert_eq!(settled(bad.wait().await).signal.as_deref(), Some("SIGKILL"));
}

// zx:test/core.test.js:1178:7:registration
#[tokio::test]
async fn kill_throws_if_too_late() {
    let p = zx!("echo foo").spawn();
    while !p.is_finished() {
        sleep(Duration::from_millis(5)).await;
    }
    let err = p.kill(None).unwrap_err();
    assert!(err.message().contains("Too late to kill the process"));
    assert_eq!(p.wait().await.unwrap().stdout, "foo\n");
}

// zx:test/core.test.js:1334:5:registration
#[tokio::test]
async fn quiet_mode_is_working() {
    let p = zx!("echo 'test'").quiet();
    assert!(p.options().quiet);
    assert_eq!(p.await.unwrap().stdout, "test\n");
}

// zx:test/core.test.js:1355:5:registration
#[tokio::test]
async fn verbose_mode_is_working() {
    let p = zx!(Shell::new().verbose(false), "echo 'test'");
    assert!(!p.options().verbose);
    let p = p.verbose();
    assert!(p.options().verbose);
    let p = zx!(Shell::new().verbose(true).verbose(false), "echo 'test'");
    assert!(!p.options().verbose);
}

// zx:test/core.test.js:1366:5:registration
#[tokio::test]
async fn nothrow_does_not_throw() {
    let o = zx!("exit 42").nothrow().await.unwrap();
    assert_eq!(o.exit_code, Some(42));
    let err = zx!(Shell::new().nothrow(false), "exit 42")
        .await
        .unwrap_err();
    assert_eq!(err.exit_code, Some(42));
}

// zx:test/core.test.js:1388:7:registration
#[tokio::test]
async fn timeout_expiration_works() {
    zx!("sleep 0.05")
        .timeout(Duration::from_secs(1))
        .await
        .unwrap();
    let err = zx!("sleep 1")
        .timeout(Duration::from_millis(200))
        .await
        .unwrap_err();
    assert_eq!(err.exit_code, None);
    assert_eq!(err.signal.as_deref(), Some("SIGTERM"));
}

// zx:test/core.test.js:1401:7:registration
#[tokio::test]
async fn timeout_accepts_a_signal_opt() {
    let err = zx!("sleep 999")
        .timeout_with(Duration::from_millis(10), "SIGKILL")
        .await
        .unwrap_err();
    assert_eq!(err.exit_code, None);
    assert_eq!(err.signal.as_deref(), Some("SIGKILL"));
}

// zx:test/core.test.js:1414:5:registration
#[tokio::test]
async fn json_works() {
    let o = zx!(r#"echo '{"key":"value"}'"#).await.unwrap();
    let v: serde_json::Value = o.json().unwrap();
    assert_eq!(v, serde_json::json!({ "key": "value" }));
}

// zx:test/core.test.js:1418:5:registration
#[tokio::test]
async fn text_works() {
    let o = zx!("echo foo").await.unwrap();
    assert_eq!(o.text(), "foo\n");
    assert_eq!(o.text_hex(), "666f6f0a");
}

// zx:test/core.test.js:1424:5:registration
#[tokio::test]
async fn lines_works() {
    let p1 = zx!("echo 'foo\nbar\r\nbaz'").await.unwrap();
    assert_eq!(p1.lines(), ["foo", "bar", "baz"]);

    let p2 = zx!("echo 'foo\nbar\r\nbaz'").run_sync().unwrap();
    assert_eq!(p2.lines(), ["foo", "bar", "baz"]);

    let dir = tempdir(None).unwrap();
    let p3 = zx!(
        Shell::new().cwd(&dir),
        "touch foo bar baz; find ./ -maxdepth 1 -type f -print0"
    )
    .await
    .unwrap();
    let mut found = p3.lines_with("\0");
    found.sort();
    assert_eq!(found, ["./bar", "./baz", "./foo"]);
    std::fs::remove_dir_all(dir).unwrap();
}

// zx:test/core.test.js:1441:5:registration
#[tokio::test]
async fn buffer_works() {
    assert_eq!(zx!("echo foo").await.unwrap().buffer(), b"foo\n");
}
