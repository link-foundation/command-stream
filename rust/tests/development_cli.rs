use assert_cmd::Command;

#[test]
fn repl_reports_missing_rust_evaluator() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing-evcxr");
    let output = Command::new(env!("CARGO_BIN_EXE_command-stream"))
        .arg("repl")
        .env("COMMAND_STREAM_EVCXR", missing)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("cargo install --locked evcxr_repl"));
}

#[test]
fn help_describes_repl_and_cargo_development() {
    let output = Command::new(env!("CARGO_BIN_EXE_command-stream"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8_lossy(&output.stdout);
    assert!(help.contains("repl"));
    assert!(help.contains("dev"));
}

#[test]
#[ignore = "requires Evcxr and rust-src; explicitly run by the Linux CI integration step"]
fn real_repl_evaluates_rust_state_and_public_command_apis() {
    let output = Command::new(env!("CARGO_BIN_EXE_command-stream"))
        .args([
            "repl",
            "--crate",
            env!("CARGO_MANIFEST_DIR"),
            "--disable-readline",
        ])
        .env("CARGO_BUILD_JOBS", "1")
        .env("CARGO_PROFILE_DEV_DEBUG", "0")
        .timeout(std::time::Duration::from_secs(240))
        .write_stdin(include_str!("../examples/repl-input.txt"))
        .output()
        .unwrap();
    let transcript = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.status.success(), "{transcript}");
    assert!(transcript.contains("RUST_REPL_VERIFIED"), "{transcript}");
    assert!(
        !transcript.contains("error[") && !transcript.contains("Error:"),
        "{transcript}"
    );
}
