#[path = "../examples/packages/mod.rs"]
mod packages;
use command_stream::commands::CommandContext;
use command_stream::CommandEnvironment;

#[tokio::test]
async fn all_ten_packages_are_installable_and_cover_the_example_catalog() {
    let mut environment = CommandEnvironment::new();
    assert_eq!(packages::all().len(), 10);
    packages::install_all(&mut environment).unwrap();
    assert_eq!(environment.list().len(), 11);
    let mut context = CommandContext::new(vec![]);
    context.stdin = Some("apple\n".into());
    assert_eq!(environment.run("upper", context).await.stdout, "APPLE\n");
    assert_eq!(
        environment
            .run("add", CommandContext::new(vec!["2".into(), "3".into()]))
            .await
            .stdout,
        "5\n"
    );
    assert_eq!(
        environment
            .run("add", CommandContext::new(vec!["NaN".into()]))
            .await
            .code,
        1
    );
    assert_eq!(
        environment
            .run(
                "deploy-plan",
                CommandContext::new(vec!["production".into(), "release-1".into()])
            )
            .await
            .stdout,
        "Validate release-1\nBuild artifact for production\nDeploy after approval\n"
    );
    assert!(environment
        .run("timestamp", CommandContext::new(vec![]))
        .await
        .stdout
        .contains('T'));
    assert!(environment
        .run(
            "json-pretty",
            CommandContext::new(vec!["{\"value\":1}".into()])
        )
        .await
        .stdout
        .contains("\"value\": 1"));
    assert_eq!(
        environment
            .run("json-pretty", CommandContext::new(vec!["invalid".into()]))
            .await
            .code,
        1
    );
    let mut context = CommandContext::new(vec!["STAGE".into()]);
    context.env = Some(packages::environment(&[("STAGE", "production")]));
    assert_eq!(
        environment.run("env-value", context).await.stdout,
        "production\n"
    );
    let result = environment
        .run(
            "log-records",
            CommandContext::new(vec!["ERROR example".into()]),
        )
        .await;
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&result.stdout).unwrap()["level"],
        "error"
    );
    let directory = tempfile::tempdir().unwrap();
    tokio::fs::write(directory.path().join("fixture"), "test")
        .await
        .unwrap();
    let mut context = CommandContext::new(vec![]);
    context.cwd = Some(directory.path().to_owned());
    assert_eq!(environment.run("file-count", context).await.stdout, "1\n");
    for package in packages::all() {
        environment.uninstall(&package.name);
    }
    assert!(environment.list().is_empty());
}

#[tokio::test]
async fn git_helpers_use_a_real_repository_and_http_uses_a_local_server() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut environment = CommandEnvironment::new();
        packages::install_all(&mut environment).unwrap();
        let directory = tempfile::tempdir().unwrap();
        assert!(command_stream::CommandBuilder::new("git")
            .arg("init")
            .cwd(directory.path())
            .run()
            .await
            .unwrap()
            .is_success());
        tokio::fs::write(directory.path().join("new-file"), "new")
            .await
            .unwrap();
        let mut context = CommandContext::new(vec![]);
        context.cwd = Some(directory.path().to_owned());
        let result = environment.run("git-summary", context).await;
        assert_eq!(result.code, 0);
        assert!(result.stdout.contains("?? new-file"));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let length = socket.read(&mut request).await.unwrap();
            assert!(length > 0);
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
                )
                .await
                .unwrap();
        });
        let result = environment
            .run("http-get", CommandContext::new(vec![url]))
            .await;
        assert_eq!(result.code, 0);
        assert_eq!(result.stdout, "hello");
        server.await.unwrap();
    })
    .await
    .unwrap();
}
