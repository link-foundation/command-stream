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
    assert!(module.contains("import { command }"));
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
