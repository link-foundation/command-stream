use command_stream::commands::VirtualCommandRegistry;
use command_stream::{CommandContext, ProcessRunner, RunOptions, StdinOption};
use serde::Deserialize;

#[derive(Deserialize, Debug)]
struct Case {
    command: String,
    args: Vec<String>,
    stdin: String,
    stdout: String,
    error: bool,
}

#[tokio::test]
async fn shared_conformance_cases() {
    let corpus = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../conformance/text-commands/cases.json");
    let cases: Vec<Case> = serde_json::from_str(
        &std::fs::read_to_string(corpus).expect("shared corpus is available in the repository"),
    )
    .unwrap();
    let registry = VirtualCommandRegistry::with_builtins();
    assert!(registry.list().len() >= 26);
    for (index, case) in cases.iter().enumerate() {
        let handler = registry
            .get(&case.command)
            .expect("new command must be registered");
        let mut context = CommandContext::new(case.args.clone());
        context.stdin = Some(case.stdin.clone());
        let result = handler(context).await;
        assert_eq!(result.code, i32::from(case.error), "case {index}: {case:?}");
        if !case.error {
            assert_eq!(result.stdout, case.stdout, "case {index}: {case:?}");
        } else {
            assert!(!result.stderr.is_empty());
        }
    }
}

#[tokio::test]
async fn files_cancellation_output_and_runner_integration() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("first file"), "a\na\nb").unwrap();
    std::fs::write(dir.path().join("-file"), "z\na\n").unwrap();
    let registry = VirtualCommandRegistry::with_builtins();
    for name in ["head", "tail", "sort", "uniq"] {
        let handler = registry.get(name).unwrap();
        for path in ["first file", "missing", "."] {
            let mut context = CommandContext::new(vec![path.to_string()]);
            context.cwd = Some(dir.path().to_path_buf());
            let result = handler(context).await;
            assert_eq!(
                result.code,
                i32::from(path != "first file"),
                "{name}: {path}"
            );
        }
        let mut context = CommandContext::new(vec!["--".into(), "-file".into()]);
        context.cwd = Some(dir.path().to_path_buf());
        assert_eq!(handler(context).await.code, 0);
        let mut context = CommandContext::new(vec![]);
        context.stdin = Some("a\n".to_string());
        context.is_cancelled = Some(Box::new(|| true));
        assert_eq!(handler(context).await.code, 130);
        if matches!(name, "head" | "tail") {
            for file in ["missing", "."] {
                let mut context = CommandContext::new(vec!["-n".into(), "0".into(), file.into()]);
                context.cwd = Some(dir.path().to_path_buf());
                assert_eq!(handler(context).await.code, 1);
            }
        }
    }
    let mut context = CommandContext::new(vec!["first file".into(), "output".into()]);
    context.cwd = Some(dir.path().to_path_buf());
    let result = registry.get("uniq").unwrap()(context).await;
    assert_eq!(result.code, 0);
    assert!(result.stdout.is_empty());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("output")).unwrap(),
        "a\nb"
    );
    let mut runner = ProcessRunner::new(
        "tail -n 0",
        RunOptions {
            stdin: StdinOption::Content("a\nb\n".into()),
            mirror: false,
            ..RunOptions::default()
        },
    );
    assert!(runner.run().await.unwrap().stdout.is_empty());
}

#[tokio::test]
async fn head_and_uniq_emit_incrementally_and_stop_when_output_closes() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("input"), "a\na\nb\nc\nd\n").unwrap();
    for name in ["head", "uniq"] {
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let mut context = CommandContext::new(vec!["input".into()]);
        context.cwd = Some(dir.path().to_path_buf());
        context.output_tx = Some(sender);
        let registry = VirtualCommandRegistry::with_builtins();
        let handler = *registry.get(name).unwrap();
        let task = tokio::spawn(async move { handler(context).await });
        assert!(
            matches!(receiver.recv().await, Some(command_stream::StreamChunk::Stdout(text)) if text == "a\n")
        );
        drop(receiver);
        assert_eq!(task.await.unwrap().code, 130);
    }
}
