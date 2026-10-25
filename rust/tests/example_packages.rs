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
async fn git_helpers_use_a_real_repository() {
    let mut environment = CommandEnvironment::new();
    packages::install_all(&mut environment).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let initialized = within(
        "git init",
        command_stream::CommandBuilder::new("git")
            .arg("init")
            .cwd(directory.path())
            .run(),
    )
    .await
    .unwrap();
    assert!(initialized.is_success(), "git init failed: {initialized:?}");
    tokio::fs::write(directory.path().join("new-file"), "new")
        .await
        .unwrap();
    let mut context = CommandContext::new(vec![]);
    context.cwd = Some(directory.path().to_owned());
    let result = within("git-summary", environment.run("git-summary", context)).await;
    assert_eq!(result.code, 0, "git-summary failed: {result:?}");
    assert!(result.stdout.contains("?? new-file"));
}

#[tokio::test]
async fn http_uses_a_local_server() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut environment = CommandEnvironment::new();
    packages::install_all(&mut environment).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 4096];
        let length = socket.read(&mut request).await.unwrap();
        assert!(length > 0);
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello")
            .await
            .unwrap();
    });
    let result = within(
        "http-get",
        environment.run("http-get", CommandContext::new(vec![url])),
    )
    .await;
    assert_eq!(result.code, 0, "http-get failed: {result:?}");
    assert_eq!(result.stdout, "hello");
    within("HTTP server response", server).await.unwrap();
}

// Bound each external operation rather than charging Git startup against the
// HTTP deadline. Test output stays captured unless a test fails or --nocapture
// is requested, and names/timings identify the stage of any future timeout.
async fn within<T>(stage: &str, future: impl std::future::Future<Output = T>) -> T {
    let started = std::time::Instant::now();
    eprintln!("Starting {stage}");
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), future)
        .await
        .unwrap_or_else(|_| panic!("{stage} did not finish within five seconds"));
    eprintln!("Completed {stage} in {:?}", started.elapsed());
    result
}
