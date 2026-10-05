use command_stream::shelljs::ShellJs;

#[tokio::test]
async fn compatibility_isolates_cwd_preserves_argv_and_returns_errors() {
    let dir = tempfile::tempdir().unwrap();
    let before = std::env::current_dir().unwrap();
    std::fs::write(dir.path().join("file with spaces.txt"), "z\na\na\nb\n").unwrap();
    let mut shell = ShellJs::new();
    shell.config.silent = true;
    assert_eq!(
        shell
            .cd(&[dir.path().to_str().unwrap()])
            .await
            .unwrap()
            .code,
        0
    );
    assert_eq!(std::env::current_dir().unwrap(), before);
    assert_eq!(
        shell.env.get("PWD").unwrap(),
        &shell.cwd().display().to_string()
    );
    assert_eq!(shell.env.get("OLDPWD").unwrap(), before.to_str().unwrap());
    assert_eq!(
        shell
            .head(&["-n", "2", "file with spaces.txt"])
            .await
            .unwrap()
            .stdout,
        "z\na\n"
    );
    assert_eq!(shell.cat(&["*.txt"]).await.unwrap().stdout, "z\na\na\nb\n");
    assert_eq!(
        shell
            .echo(&["one", "two words", "$(touch injected)"])
            .await
            .unwrap()
            .stdout,
        "one two words $(touch injected)\n"
    );
    assert!(!dir.path().join("injected").exists());
    assert_eq!(shell.cat(&["missing"]).await.unwrap().code, 1);
    assert_eq!(shell.error_code(), 1);
    assert!(shell.error().is_some());
    shell.config.fatal = true;
    assert!(shell.cat(&["missing"]).await.is_err());
}

#[tokio::test]
async fn compatibility_directory_stack_text_commands_and_writes() {
    let dir = tempfile::tempdir().unwrap();
    let mut shell = ShellJs::new();
    shell.config.silent = true;
    let before = shell.cwd().canonicalize().unwrap();
    shell.pushd(&[dir.path().to_str().unwrap()]).await.unwrap();
    // cd resolves symlinks and removes Windows verbatim path prefixes. Check
    // directory identity and stack order rather than the caller's spelling.
    let dirs = shell.dirs();
    let paths: Vec<_> = dirs
        .stdout
        .lines()
        .map(|path| std::path::Path::new(path).canonicalize().unwrap())
        .collect();
    assert_eq!(
        paths,
        vec![dir.path().canonicalize().unwrap(), before.clone()]
    );
    let text = command_stream::CommandResult::success("hello\nworld\n");
    shell.to(&text, "output", false).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("output")).unwrap(),
        "hello\nworld\n"
    );
    shell
        .to(
            &command_stream::CommandResult::success("more\n"),
            "output",
            true,
        )
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("output")).unwrap(),
        "hello\nworld\nmore\n"
    );
    assert!(shell.test(&["-f", "output"]).await.unwrap());
    assert_eq!(
        shell.grep(&["world", "output"]).await.unwrap().stdout,
        "world\n"
    );
    assert_eq!(
        shell
            .sed(&["world", "friend", "output"])
            .await
            .unwrap()
            .stdout,
        "hello\nfriend\nmore\n"
    );
    assert_eq!(shell.find(&["."]).await.unwrap().code, 0);
    shell.popd().await.unwrap();
    assert_eq!(shell.cwd().canonicalize().unwrap(), before);
    assert_eq!(shell.dirs().stdout.lines().count(), 1);
    assert_eq!(
        shell.call("nonexistent-command", &[]).await.unwrap().code,
        127
    );
}

#[tokio::test]
async fn compatibility_extra_commands_flags_errors_and_session_state() {
    let dir = tempfile::tempdir().unwrap();
    let mut shell = ShellJs::new();
    shell.config.silent = true;
    shell.cd(&[dir.path().to_str().unwrap()]).await.unwrap();
    std::fs::write(
        dir.path().join("input.txt"),
        "WARN one one\ninfo\nwarn two\n",
    )
    .unwrap();
    assert_eq!(
        shell
            .grep(&["-in", "warn", "input.txt"])
            .await
            .unwrap()
            .stdout,
        "1:WARN one one\n3:warn two\n"
    );
    assert_eq!(
        shell
            .grep(&["-v", "warn", "input.txt"])
            .await
            .unwrap()
            .stdout,
        "WARN one one\ninfo\n"
    );
    assert_eq!(
        shell
            .grep(&["-il", "warn", "input.txt"])
            .await
            .unwrap()
            .stdout,
        "input.txt\n"
    );
    shell
        .sed(&["-ig", "one", "new", "input.txt"])
        .await
        .unwrap();
    assert!(std::fs::read_to_string(dir.path().join("input.txt"))
        .unwrap()
        .starts_with("WARN new new\n"));
    assert_eq!(shell.ln(&["input.txt", "hard-link"]).await.unwrap().code, 0);
    assert_eq!(
        shell.cat(&["hard-link"]).await.unwrap().stdout,
        shell.cat(&["input.txt"]).await.unwrap().stdout
    );
    assert_eq!(shell.chmod(&["644", "hard-link"]).await.unwrap().code, 0);
    assert!(shell
        .find(&["."])
        .await
        .unwrap()
        .stdout
        .contains("hard-link"));
    for (command, args) in [
        ("grep", vec!["[", "input.txt"]),
        ("sed", vec!["-x", "one", "new", "input.txt"]),
        ("ln", vec!["input.txt"]),
        ("chmod", vec!["not-octal", "input.txt"]),
        ("find", vec!["missing"]),
    ] {
        assert_eq!(
            shell.call(command, &args).await.unwrap().code,
            1,
            "{command}"
        );
        assert_eq!(shell.error_code(), 1);
        assert!(shell.error().is_some());
    }
    let cwd = shell.cwd().to_path_buf();
    assert_eq!(shell.pushd(&["missing"]).await.unwrap().code, 1);
    assert_eq!(shell.cwd(), cwd);
    assert_eq!(shell.popd().await.unwrap().code, 1);
    shell.set("-f").unwrap();
    assert_eq!(shell.cat(&["*.txt"]).await.unwrap().code, 1);
    shell.set("+f").unwrap();
    assert_eq!(shell.cat(&["*.txt"]).await.unwrap().code, 0);
    assert_eq!(shell.error_code(), 0);
    assert!(shell.error().is_none());
    assert!(!shell.test(&["-f", "missing"]).await.unwrap());
}
