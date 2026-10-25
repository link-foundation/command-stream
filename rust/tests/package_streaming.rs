use command_stream::command_packages::argv_handler;
use command_stream::commands::{CommandContext, StreamChunk};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[test]
fn manifest_child_fixture() {
    if std::env::var_os("COMMAND_STREAM_PACKAGE_CHILD").is_none() {
        return;
    }
    use std::io::Write;
    let mut stdout = std::io::stdout();
    stdout.write_all(b"utf8:\xc3").unwrap();
    stdout.flush().unwrap();
    std::thread::sleep(Duration::from_millis(100));
    stdout.write_all(b"\xa9\nready\n").unwrap();
    stdout.flush().unwrap();
    std::thread::sleep(Duration::from_secs(2));
}

fn context(
    tx: tokio::sync::mpsc::Sender<StreamChunk>,
    cancelled: Arc<AtomicBool>,
) -> CommandContext {
    let mut context = CommandContext::new(vec![]);
    context.env = Some(std::collections::HashMap::from([(
        "COMMAND_STREAM_PACKAGE_CHILD".into(),
        "true".into(),
    )]));
    context.output_tx = Some(tx);
    context.is_cancelled = Some(Box::new(move || cancelled.load(Ordering::SeqCst)));
    context
}

fn handler() -> command_stream::PackageHandler {
    argv_handler(
        std::env::current_exe().unwrap().to_string_lossy(),
        vec![
            "--exact".into(),
            "manifest_child_fixture".into(),
            "--nocapture".into(),
        ],
    )
}

#[tokio::test]
async fn streamed_manifests_preserve_split_utf8_and_emit_before_exit() {
    tokio::time::timeout(Duration::from_secs(5), async {
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        let cancelled = Arc::new(AtomicBool::new(false));
        let task = tokio::spawn(handler()(context(tx, cancelled.clone())));
        let mut output = String::new();
        while !output.contains("ready\n") {
            match rx.recv().await.expect("child stopped before output") {
                StreamChunk::Stdout(chunk) => output.push_str(&chunk),
                StreamChunk::Stderr(chunk) => panic!("{chunk}"),
            }
        }
        let was_running = !task.is_finished();
        cancelled.store(true, Ordering::SeqCst);
        while rx.recv().await.is_some() {}
        let result = task.await.unwrap();
        assert!(was_running, "output was delayed until child exit");
        assert!(
            output.contains("utf8:é\nready\n"),
            "UTF-8 was corrupted: {output:?}"
        );
        assert_ne!(result.code, 0);
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn manifest_cancellation_interrupts_a_paused_output_consumer() {
    tokio::time::timeout(Duration::from_secs(5), async {
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut task = tokio::spawn(handler()(context(tx, cancelled.clone())));
        tokio::time::sleep(Duration::from_millis(250)).await;
        cancelled.store(true, Ordering::SeqCst);
        let observed = tokio::time::timeout(Duration::from_secs(1), &mut task).await;
        if observed.is_err() {
            task.abort();
            let _ = task.await;
        }
        assert!(
            observed.is_ok(),
            "cancellation was blocked by a full output channel"
        );
        assert_eq!(observed.unwrap().unwrap().code, 130);
    })
    .await
    .unwrap();
}
