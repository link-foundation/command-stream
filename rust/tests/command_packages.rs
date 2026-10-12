use command_stream::{commands::CommandContext, CommandEnvironment, CommandPackage, CommandResult};
use std::collections::HashMap;

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
