use command_stream::{dev, DevEvent, DevOptions};
use std::time::Duration;

#[test]
fn watched_child() {
    if std::env::var_os("COMMAND_STREAM_DEV_CHILD").is_some() {
        std::thread::sleep(Duration::from_secs(60));
    }
}

#[tokio::test]
async fn watcher_restarts_for_create_edit_and_delete_and_closes() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().canonicalize().unwrap();
        let file = cwd.join("scripts");
        std::fs::create_dir(&file).unwrap();
        let mut controller = dev(DevOptions {
            cwd: cwd.clone(),
            watch: vec!["./scripts/*.rs".into()],
            command: vec![
                std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                "--exact".into(),
                "watched_child".into(),
                "--nocapture".into(),
            ],
            interval: Duration::from_millis(10),
            debounce: Duration::ZERO,
            ..Default::default()
        })
        .await
        .unwrap();
        let mut pid = match controller.next_event().await.unwrap() {
            DevEvent::Restarted { files, pid } => {
                assert!(files.is_empty());
                pid.unwrap()
            }
            DevEvent::Error(message) => panic!("{message}"),
        };
        let watched = file.join("app.rs");
        for revision in [Some("first"), Some("second longer"), None] {
            if let Some(content) = revision {
                std::fs::write(&watched, content).unwrap();
            } else {
                std::fs::remove_file(&watched).unwrap();
            }
            match controller.next_event().await.unwrap() {
                DevEvent::Restarted { files, pid: next } => {
                    assert_eq!(files, vec![watched.clone()]);
                    assert_stopped(pid);
                    pid = next.unwrap();
                }
                DevEvent::Error(message) => panic!("{message}"),
            }
        }
        controller.close().await.unwrap();
        assert_stopped(pid);
    })
    .await
    .expect("watcher test exceeded 10 seconds");
}

fn assert_stopped(pid: u32) {
    #[cfg(unix)]
    assert!(nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None).is_err());
    #[cfg(not(unix))]
    let _ = pid;
}

#[tokio::test]
async fn invalid_watcher_options_fail_immediately() {
    assert!(dev(DevOptions {
        interval: Duration::ZERO,
        ..Default::default()
    })
    .await
    .is_err());
    assert!(dev(DevOptions {
        command: vec![],
        ..Default::default()
    })
    .await
    .is_err());
    assert!(dev(DevOptions {
        watch: vec!["[".into()],
        initial: false,
        ..Default::default()
    })
    .await
    .is_err());
}

#[tokio::test]
async fn default_patterns_match_root_sources_and_ignore_build_output() {
    tokio::time::timeout(Duration::from_secs(5), async {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().canonicalize().unwrap();
        std::fs::create_dir(cwd.join("target")).unwrap();
        let mut controller = dev(DevOptions {
            cwd: cwd.clone(),
            command: vec![
                std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                "--exact".into(),
                "watched_child".into(),
            ],
            initial: false,
            interval: Duration::from_millis(10),
            debounce: Duration::ZERO,
            ..Default::default()
        })
        .await
        .unwrap();
        std::fs::write(cwd.join("target/generated.rs"), "ignored").unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), controller.next_event())
                .await
                .is_err()
        );
        let source = cwd.join("main.rs");
        std::fs::write(&source, "watched").unwrap();
        let pid = match controller.next_event().await.unwrap() {
            DevEvent::Restarted { files, pid } => {
                assert_eq!(files, vec![source]);
                pid.unwrap()
            }
            DevEvent::Error(message) => panic!("{message}"),
        };
        controller.close().await.unwrap();
        assert_stopped(pid);
    })
    .await
    .expect("default-pattern test exceeded five seconds");
}
