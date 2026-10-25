use command_stream::commands::StreamChunk;
use command_stream::{commands::CommandContext, CommandEnvironment, CommandPackage, CommandResult};
use std::collections::HashMap;
use std::sync::Arc;

#[tokio::test]
async fn middleware_inheritance_and_atomic_packages() {
    let mut environment = CommandEnvironment::new();
    environment
        .create("hello", |context| async move {
            CommandResult::success(context.args.join(" "))
        })
        .unwrap();
    environment
        .inherit("greet", "hello", vec!["hello".into()])
        .unwrap();
    environment
        .extend("greet", |context, next| {
            Box::pin(async move {
                let result = next(context).await;
                CommandResult::success(format!("{}!", result.stdout))
            })
        })
        .unwrap();
    assert_eq!(
        environment
            .run("greet", CommandContext::new(vec!["world".into()]))
            .await
            .stdout,
        "hello world!"
    );
    environment.compose("pipeline", &["hello", "cat"]).unwrap();
    assert_eq!(
        environment
            .run("pipeline", CommandContext::new(vec![]))
            .await
            .code,
        0
    );
    let handler = environment.get("hello").unwrap();
    let package = CommandPackage {
        name: "test".into(),
        version: "1.0.0".into(),
        commands: HashMap::from([
            ("installed".into(), handler.clone()),
            ("bad name".into(), handler),
        ]),
    };
    assert!(environment.install(package).is_err());
    assert!(!environment.list().contains(&"installed".into()));
}

#[tokio::test]
async fn manifest_reload_passes_literal_arguments_and_stdin() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("package.json");
    tokio::fs::write(
        &file,
        serde_json::json!({"name":"fixture", "version":"1", "commands":{"fixture": if cfg!(windows) {
            serde_json::json!({"file":"powershell", "args":["-NoProfile", "-Command", "[Console]::Write([Console]::In.ReadToEnd())"]})
        } else { serde_json::json!({"file":"cat"}) }}}).to_string(),
    )
    .await
    .unwrap();
    let mut environment = CommandEnvironment::new();
    environment
        .install(CommandPackage::load(&file).await.unwrap())
        .unwrap();
    let mut context = CommandContext::new(vec![]);
    context.stdin = Some("hello".into());
    assert_eq!(environment.run("fixture", context).await.stdout, "hello");
    environment.uninstall("fixture");
    assert_eq!(
        environment
            .run("fixture", CommandContext::new(vec![]))
            .await
            .code,
        127
    );
}

#[tokio::test]
async fn package_collision_with_builtin_is_rejected_atomically() {
    let mut environment = CommandEnvironment::new();
    let handler = environment.get("true").unwrap();
    let original = environment.list();
    assert!(environment
        .install(CommandPackage {
            name: "builtin-collision".into(),
            version: "1".into(),
            commands: HashMap::from([
                ("fresh-command".into(), handler.clone()),
                ("echo".into(), handler),
            ]),
        })
        .is_err());
    assert_eq!(environment.list(), original);
    assert_eq!(
        environment
            .run("echo", CommandContext::new(vec!["original".into()]))
            .await
            .stdout,
        "original\n"
    );
}

#[tokio::test]
async fn composition_preserves_cancellation_and_captures_intermediate_output() {
    let mut environment = CommandEnvironment::new();
    environment
        .create("first", |context| async move {
            assert!(context.is_cancelled(), "composition dropped cancellation");
            if let Some(tx) = context.output_tx {
                tx.send(StreamChunk::Stdout("untransformed".into()))
                    .await
                    .unwrap();
            }
            CommandResult::success("first")
        })
        .unwrap();
    environment
        .create("last", |context| async move {
            assert!(context.is_cancelled());
            assert_eq!(context.stdin.as_deref(), Some("first"));
            CommandResult::success("TRANSFORMED")
        })
        .unwrap();
    environment.compose("pipeline", &["first", "last"]).unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel(2);
    let mut context = CommandContext::new(vec![]);
    context.output_tx = Some(tx);
    context.is_cancelled = Some(Box::new(|| true));
    assert_eq!(
        environment.run("pipeline", context).await.stdout,
        "TRANSFORMED"
    );
    assert!(
        rx.recv().await.is_none(),
        "intermediate output escaped composition"
    );
}

#[tokio::test]
async fn middleware_inheritance_and_incremental_output() {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut environment = CommandEnvironment::new();
        let release = Arc::new(tokio::sync::Notify::new());
        let gate = release.clone();
        environment.create("records", move |context| {
            let gate = gate.clone();
            async move {
                let tx = context.output_tx.unwrap();
                tx.send(StreamChunk::Stdout(format!("first:{}", context.args.join(" ")))).await.unwrap();
                gate.notified().await;
                tx.send(StreamChunk::Stdout("second".into())).await.unwrap();
                CommandResult::success_empty()
            }
        }).unwrap();
        environment.extend("records", |context, next| next(context)).unwrap();
        environment.inherit("child", "records", vec!["inherited".into()]).unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        let mut context = CommandContext::new(vec!["value".into()]);
        context.output_tx = Some(tx);
        let task = tokio::spawn(async move { environment.run("child", context).await });
        assert!(matches!(rx.recv().await, Some(StreamChunk::Stdout(value)) if value == "first:inherited value"));
        assert!(!task.is_finished());
        release.notify_one();
        assert!(matches!(rx.recv().await, Some(StreamChunk::Stdout(value)) if value == "second"));
        assert_eq!(task.await.unwrap().code, 0);
    }).await.expect("incremental streaming exceeded five seconds");
}

#[tokio::test]
async fn invalid_names_are_rejected_before_mutation() {
    let mut environment = CommandEnvironment::new();
    for name in [
        "",
        "two words",
        "7command",
        "command;echo",
        "écho",
        "line\n",
    ] {
        let original = environment.list();
        assert!(environment
            .create(name, |_| async { CommandResult::success_empty() })
            .is_err());
        assert!(environment.inherit(name, "echo", vec![]).is_err());
        assert!(environment.compose(name, &["echo"]).is_err());
        assert_eq!(environment.list(), original);
    }
    for name in [
        "ecosystem:hello",
        "ecosystem-hello",
        "ecosystem.hello",
        "_hello",
    ] {
        environment
            .create(name, |_| async { CommandResult::success("hello") })
            .unwrap();
        assert_eq!(
            environment
                .run(name, CommandContext::new(vec![]))
                .await
                .stdout,
            "hello"
        );
    }
}

#[tokio::test]
async fn replacement_restores_displaced_handlers_and_preserves_external_changes() {
    use command_stream::command_packages::InstallOptions;
    let mut environment = CommandEnvironment::new();
    environment
        .create("owned", |_| async { CommandResult::success("original") })
        .unwrap();
    let handler = environment.get("true").unwrap();
    let package = || CommandPackage {
        name: "replacement".into(),
        version: "1".into(),
        commands: HashMap::from([("owned".into(), handler.clone())]),
    };
    assert!(environment.install(package()).is_err());
    environment
        .install_with_options(package(), InstallOptions { replace: true })
        .unwrap();
    environment.install(package()).unwrap();
    environment.uninstall("replacement");
    assert_eq!(
        environment
            .run("owned", CommandContext::new(vec![]))
            .await
            .stdout,
        "original"
    );
    environment
        .install_with_options(package(), InstallOptions { replace: true })
        .unwrap();
    environment
        .extend("owned", |context, next| {
            Box::pin(async move {
                let mut result = next(context).await;
                result.stdout = "external".into();
                result
            })
        })
        .unwrap();
    environment.uninstall("replacement");
    assert_eq!(
        environment
            .run("owned", CommandContext::new(vec![]))
            .await
            .stdout,
        "external"
    );
    assert!(environment.unregister("owned"));
    assert_eq!(
        environment
            .run("owned", CommandContext::new(vec![]))
            .await
            .code,
        127
    );
}

#[tokio::test]
async fn composition_collects_streamed_stages_and_stops_on_failure() {
    let mut environment = CommandEnvironment::new();
    environment
        .create("generator", |context| async move {
            let tx = context.output_tx.unwrap();
            for index in 0..40 {
                tx.send(StreamChunk::Stdout(format!("{index}\n")))
                    .await
                    .unwrap();
            }
            CommandResult::success_empty()
        })
        .unwrap();
    environment
        .create("fail", |context| async move {
            assert_eq!(context.stdin.as_ref().unwrap().lines().count(), 40);
            CommandResult::new(context.stdin.unwrap().to_uppercase(), "stop", 7)
        })
        .unwrap();
    environment
        .create("unreachable", |_| async {
            panic!("composition continued after failure")
        })
        .unwrap();
    assert!(environment.compose("empty", &[]).is_err());
    assert!(environment.compose("unknown", &["missing"]).is_err());
    environment
        .compose("pipeline", &["generator", "fail", "unreachable"])
        .unwrap();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        environment.run("pipeline", CommandContext::new(vec![])),
    )
    .await
    .unwrap();
    assert_eq!(result.code, 7);
    assert_eq!(result.stderr, "stop");
    assert_eq!(result.stdout.lines().count(), 40);
}

#[tokio::test]
async fn invalid_reload_preserves_old_version_and_removed_commands_are_uninstalled() {
    let mut environment = CommandEnvironment::new();
    let handler = environment.get("true").unwrap();
    let package = |version: &str, names: &[&str]| CommandPackage {
        name: "atomic".into(),
        version: version.into(),
        commands: names
            .iter()
            .map(|name| ((*name).into(), handler.clone()))
            .collect(),
    };
    environment.install(package("1", &["old"])).unwrap();
    for names in [&[][..], &["new", "bad name"][..], &["new", "echo"][..]] {
        assert!(environment.install(package("2", names)).is_err());
        assert_eq!(environment.installed("atomic").unwrap().version, "1");
        assert_eq!(environment.list(), vec!["old"]);
    }
    environment.install(package("2", &["new"])).unwrap();
    assert_eq!(environment.list(), vec!["new"]);
    assert_eq!(environment.installed("atomic").unwrap().version, "2");
    environment.uninstall("atomic");
    assert!(environment.list().is_empty());
}
