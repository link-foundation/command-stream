use command_stream::command_packages::{watch_package, Marketplace, SearchOptions};
use command_stream::{commands::CommandContext, CommandEnvironment};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, RwLock};

#[tokio::test]
async fn marketplace_encodes_queries_bounds_size_and_propagates_transport_errors() {
    let packages = Marketplace::search_with("git & déploy", SearchOptions {
        registry: "https://registry.example.test/".into(), size: 999, ..Default::default()
    }, |url| async move {
        assert_eq!(url, "https://registry.example.test/-/v1/search?text=keywords%3Acommand-stream-command%20git%20%26%20d%C3%A9ploy&size=250");
        Ok(json!({"objects":[{"package":{"name":"tools","version":"1","description":"Git helpers","keywords":["command-stream-command"]}}]}))
    }).await.unwrap();
    assert_eq!(packages[0].name, "tools");
    assert_eq!(
        packages[0].extra["keywords"],
        json!(["command-stream-command"])
    );
    assert_eq!(
        Marketplace::search_with("git", SearchOptions::default(), |_| async {
            Err("HTTP 503".into())
        })
        .await
        .unwrap_err(),
        "HTTP 503"
    );
    assert!(
        Marketplace::search_with("git", SearchOptions::default(), |_| async {
            Ok(json!({"wrong":[]}))
        })
        .await
        .is_err()
    );
    assert!(Marketplace::search_with(
        "git",
        SearchOptions {
            registry: "file:///tmp".into(),
            ..Default::default()
        },
        |_| async { panic!("invalid origin invoked transport") }
    )
    .await
    .is_err());
    Marketplace::search_with(
        "git",
        SearchOptions {
            size: 0,
            ..Default::default()
        },
        |url| async move {
            assert!(url.ends_with("&size=1"));
            Ok(json!({"objects":[]}))
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn marketplace_cancellation_aborts_pending_transport() {
    tokio::time::timeout(Duration::from_secs(5), async {
        let (cancel, receiver) = watch::channel(false);
        let task = tokio::spawn(Marketplace::search_with(
            "git",
            SearchOptions {
                cancel: Some(receiver),
                ..Default::default()
            },
            |_| std::future::pending(),
        ));
        cancel.send(true).unwrap();
        assert_eq!(
            task.await.unwrap().unwrap_err(),
            "Marketplace search cancelled"
        );
        let (_, receiver) = watch::channel(true);
        assert!(Marketplace::search_with(
            "git",
            SearchOptions {
                cancel: Some(receiver),
                ..Default::default()
            },
            |_| async { panic!("pre-cancelled request started") }
        )
        .await
        .is_err());
        let (_, receiver) = watch::channel(false);
        assert!(Marketplace::search_with(
            "git",
            SearchOptions {
                cancel: Some(receiver),
                ..Default::default()
            },
            |_| async { Ok(json!({"objects":[]})) }
        )
        .await
        .unwrap()
        .is_empty());
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn marketplace_default_transport_uses_a_real_http_registry() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    tokio::time::timeout(Duration::from_secs(5), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let registry = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let length = socket.read(&mut request).await.unwrap();
            assert!(String::from_utf8_lossy(&request[..length]).starts_with("GET /-/v1/search?text=keywords%3Acommand-stream-command%20git&size=20 HTTP/1.1"));
            let body = json!({"objects":[{"package":{"name":"real-registry-response","version":"1.0.0"}}]}).to_string();
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        assert_eq!(Marketplace::search("git", SearchOptions { registry, ..Default::default() }).await.unwrap()[0].name, "real-registry-response");
        server.await.unwrap();
    }).await.unwrap();
}

fn manifest(version: &str, commands: serde_json::Value) -> String {
    json!({"name":"reload-demo","version":version,"commands":commands}).to_string()
}

#[tokio::test]
async fn npm_manifests_resolve_scoped_names_and_versions_without_installing() {
    let directory = tempfile::tempdir().unwrap();
    let package = directory.path().join("node_modules/@example/tools");
    tokio::fs::create_dir_all(&package).await.unwrap();
    tokio::fs::write(
        package.join("command-stream.json"),
        manifest("1", json!({"npm-fixture":{"file":"echo"}})),
    )
    .await
    .unwrap();
    let mut environment = CommandEnvironment::new();
    assert_eq!(
        environment
            .install_npm("@example/tools@1.0.0", directory.path(), false)
            .await
            .unwrap(),
        "reload-demo"
    );
    assert_eq!(environment.list(), vec!["npm-fixture"]);
    for name in ["", "two words", "../tools", "..", "--bad-flag", "@../tools"] {
        assert!(environment
            .install_npm(name, directory.path(), false)
            .await
            .is_err());
        assert_eq!(environment.list(), vec!["npm-fixture"]);
    }
    assert!(environment
        .install_npm("missing-package", directory.path(), false)
        .await
        .is_err());
    environment.uninstall("reload-demo");
    assert!(environment.list().is_empty());
}

#[tokio::test]
async fn npm_installation_uses_real_local_packages_and_disables_lifecycle_scripts() {
    let directory = tempfile::tempdir().unwrap();
    let outcome = tokio::time::timeout(Duration::from_secs(15), async {
        let source = directory.path().join("source");
        tokio::fs::create_dir_all(&source).await.unwrap();
        tokio::fs::write(source.join("package.json"), json!({
            "name":"@example/tools", "version":"1.0.0",
            "scripts":{"install":"node -e \"process.exit(99)\""}
        }).to_string()).await.unwrap();
        tokio::fs::write(source.join("command-stream.json"), manifest("1", json!({"offline-npm":{"file":"echo"}}))).await.unwrap();
        tokio::fs::write(directory.path().join("package.json"), json!({
            "name":"offline-consumer", "version":"1.0.0", "dependencies":{"@example/tools":"file:./source"}
        }).to_string()).await.unwrap();
        // Keep the offline fixture independent of the runner's shared npm cache
        // and update notifier. Preserve verbose diagnostics if its deadline fires.
        let npm_path = |name| directory.path().join(name).to_string_lossy().replace('\\', "/");
        tokio::fs::write(directory.path().join(".npmrc"), format!(
            "offline=true\nregistry=http://127.0.0.1:9\ncache={}\nlogs-dir={}\nloglevel=verbose\nupdate-notifier=false\nfetch-retries=0\n",
            npm_path("npm-cache"), npm_path("npm-logs")
        )).await.unwrap();
        let mut environment = CommandEnvironment::new();
        assert_eq!(environment.install_npm("@example/tools", directory.path(), true).await.unwrap(), "reload-demo");
        assert_eq!(environment.list(), vec!["offline-npm"]);
        assert!(directory.path().join("node_modules/@example/tools/command-stream.json").exists());
    }).await;
    if outcome.is_err() {
        if let Ok(mut logs) = tokio::fs::read_dir(directory.path().join("npm-logs")).await {
            while let Ok(Some(log)) = logs.next_entry().await {
                if let Ok(content) = tokio::fs::read_to_string(log.path()).await {
                    eprintln!("npm diagnostic {}:\n{content}", log.path().display());
                }
            }
        }
    }
    outcome.expect("offline npm installation exceeded fifteen seconds");
}

#[tokio::test]
async fn manifest_watching_reloads_atomically_and_stops_on_close() {
    tokio::time::timeout(Duration::from_secs(5), async {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("commands.json");
        let definition = json!({"reload-echo":{"file":if cfg!(windows) { "cmd" } else { "echo" },"args":if cfg!(windows) { vec!["/c", "echo", "literal;&"] } else { vec!["literal;&"] }}});
        tokio::fs::write(&file, manifest("1", definition.clone())).await.unwrap();
        let environment = Arc::new(RwLock::new(CommandEnvironment::new()));
        let mut watcher = watch_package(environment.clone(), &file, Duration::from_millis(10)).await.unwrap();
        assert_eq!(environment.write().await.install_file(&file).await.unwrap(), "reload-demo");
        assert_eq!(environment.read().await.installed("reload-demo").unwrap().version, "1");
        let replacement = directory.path().join("replacement.json");
        tokio::fs::write(&replacement, manifest("2", definition.clone())).await.unwrap();
        // Windows rename does not replace an existing file.
        #[cfg(windows)] tokio::fs::remove_file(&file).await.unwrap();
        tokio::fs::rename(&replacement, &file).await.unwrap();
        loop { if watcher.next_event().await.unwrap().is_ok() { break; } }
        assert_eq!(environment.read().await.installed("reload-demo").unwrap().version, "2");
        tokio::fs::write(&file, manifest("bad", json!({"new-command":{"file":"echo"},"bad name":{"file":"echo"}}))).await.unwrap();
        assert!(watcher.next_event().await.unwrap().is_err());
        assert_eq!(environment.read().await.installed("reload-demo").unwrap().version, "2");
        assert!(!environment.read().await.list().contains(&"new-command".into()));
        tokio::fs::write(&file, manifest("3", definition.clone())).await.unwrap();
        assert!(watcher.next_event().await.unwrap().is_ok());
        watcher.close().await.unwrap();
        tokio::fs::write(&file, manifest("4", definition)).await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(environment.read().await.installed("reload-demo").unwrap().version, "3");
        assert_eq!(environment.read().await.run("reload-echo", CommandContext::new(vec![])).await.code, 0);
        assert!(watch_package(environment, &file, Duration::ZERO).await.is_err());
    }).await.expect("manifest watcher exceeded five seconds");
}

#[cfg(unix)]
#[tokio::test]
async fn linked_manifests_have_one_installation_identity() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("commands.json");
    let link = directory.path().join("linked.json");
    tokio::fs::write(&file, manifest("1", json!({"linked":{"file":"echo"}})))
        .await
        .unwrap();
    std::os::unix::fs::symlink(&file, &link).unwrap();
    let mut environment = CommandEnvironment::new();
    environment.install_file(&file).await.unwrap();
    tokio::fs::write(&file, manifest("2", json!({"linked":{"file":"echo"}})))
        .await
        .unwrap();
    environment.install_file(&link).await.unwrap();
    assert_eq!(environment.installed("reload-demo").unwrap().version, "1");
    environment.reload_file(&link).await.unwrap();
    assert_eq!(environment.installed("reload-demo").unwrap().version, "2");
    environment.uninstall("reload-demo");
    assert!(environment.installed("reload-demo").is_none());
    environment.install_file(&link).await.unwrap();
    assert_eq!(environment.list(), vec!["linked"]);
}
