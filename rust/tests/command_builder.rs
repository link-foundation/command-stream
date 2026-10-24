use command_stream::CommandBuilder;

#[tokio::test]
async fn literal_arguments_and_exit_status() {
    let result = CommandBuilder::new(if cfg!(windows) { "cmd" } else { "sh" })
        .args(if cfg!(windows) {
            vec!["/C", "exit 7"]
        } else {
            vec!["-c", "exit 7"]
        })
        .run()
        .await
        .unwrap();
    assert_eq!(result.code, 7);
}

#[cfg(unix)]
#[tokio::test]
async fn hostile_arguments_stay_literal() {
    let result = CommandBuilder::new("printf")
        .args(["%s|", "", "a b", "$(echo injected)", "a'b"])
        .run()
        .await
        .unwrap();
    assert_eq!(result.stdout, "|a b|$(echo injected)|a'b|");
}

#[test]
fn fy_cli_creates_a_module_and_refuses_to_overwrite() {
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("script.sh");
    let output = directory.path().join("script.mjs");
    std::fs::write(&input, "echo hello\n").unwrap();
    let binary = env!("CARGO_BIN_EXE_command-stream");
    assert!(std::process::Command::new(binary)
        .arg("fy")
        .arg(&input)
        .arg(&output)
        .status()
        .unwrap()
        .success());
    let module = std::fs::read_to_string(&output).unwrap();
    assert!(module.contains("const { command } = await use"));
    assert!(module.contains("echo hello"));
    assert!(!std::process::Command::new(binary)
        .arg("fy")
        .arg(&input)
        .arg(&output)
        .output()
        .unwrap()
        .status
        .success());
    assert_eq!(std::fs::read_to_string(output).unwrap(), module);
}

#[test]
fn builder_composition_and_sync_execution() {
    let builder = CommandBuilder::new(if cfg!(windows) { "cmd" } else { "sh" })
        .args(if cfg!(windows) {
            vec!["/C", "exit 7"]
        } else {
            vec!["-c", "exit 7"]
        })
        .pipe(|builder| builder.stderr(command_stream::CommandStdio::Ignore));
    assert_eq!(builder.run_sync().unwrap().code, 7);
    assert_eq!(builder.run_sync().unwrap().code, 7);
}

#[cfg(unix)]
#[tokio::test]
async fn builder_env_layers_and_large_stdin() {
    let builder = CommandBuilder::new("sh")
        .args([
            "-c",
            "printf '%s|%s|' \"$BUILDER_A\" \"${BUILDER_B-unset}\"; cat",
        ])
        .env_clear()
        .envs([("BUILDER_A", "a"), ("BUILDER_B", "removed")])
        .env_remove("BUILDER_B")
        .stdin(command_stream::StdinOption::Content("input".repeat(32768)));
    let expected = format!("a|unset|{}", "input".repeat(32768));
    assert_eq!(builder.run().await.unwrap().stdout, expected);
    assert_eq!(builder.run_sync().unwrap().stdout, expected);
}

#[cfg(unix)]
#[tokio::test]
async fn cwd_and_stdio_policies_match_sync_and_async() {
    use command_stream::CommandStdio;
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("input.txt"), "from cwd").unwrap();
    let builder = CommandBuilder::new("sh")
        .args(["-c", "cat input.txt; printf hidden >&2"])
        .cwd(directory.path())
        .stderr(CommandStdio::Ignore);
    let result = builder.run().await.unwrap();
    assert_eq!(result.stdout, "from cwd");
    assert_eq!(result.stderr, "");
    let result = builder
        .clone()
        .stdout(CommandStdio::Ignore)
        .run_sync()
        .unwrap();
    assert_eq!(result.stdout, "");
    assert_eq!(result.stderr, "");
    assert_eq!(result.code, 0);
}
