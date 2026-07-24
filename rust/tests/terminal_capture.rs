#![cfg(unix)]

use command_stream::terminal::{
    capture_terminal, TerminalCaptureOptions, TerminalInteraction, TerminalKey, TerminalResize,
};
use std::fs;
use std::time::Duration;
use tempfile::tempdir;

fn shell_options(script: &str) -> TerminalCaptureOptions {
    TerminalCaptureOptions {
        file: "/bin/sh".into(),
        args: vec!["-c".into(), script.into()],
        cols: 24,
        rows: 6,
        settle_duration: Duration::from_millis(10),
        timeout: Duration::from_secs(3),
        ..TerminalCaptureOptions::default()
    }
}

#[test]
fn drives_input_control_keys_and_terminal_resize() {
    let script = r#"
printf '\033[2J\033[Hready:'
stty size
IFS= read -r answer
printf '\033[2J\033[Huser:%s\nwaiting-resize\n' "$answer"
while [ "$(stty size)" != "10 40" ]; do sleep 0.01; done
printf '\033[2J\033[Huser:%s\nassistant:done\nresized:' "$answer"
stty size
"#;
    let mut options = shell_options(script);
    options.interactions = vec![
        TerminalInteraction {
            after: Some("ready:".into()),
            text: Some("hello".into()),
            key: Some(TerminalKey::Enter),
            resize: None,
        },
        TerminalInteraction {
            after: Some("waiting-resize".into()),
            text: None,
            key: None,
            resize: Some(TerminalResize { cols: 40, rows: 10 }),
        },
    ];

    let capture = capture_terminal(options).expect("capture should complete");

    assert_eq!(capture.exit_code, 0);
    assert_eq!(capture.interaction_count, 2);
    assert!(capture.transcript.contains("user:hello"));
    assert!(capture.transcript.contains("assistant:done"));
    assert!(capture.transcript.contains("resized:10 40"));
    assert!(capture
        .asciicast
        .events
        .iter()
        .any(|event| event.code == "i" && event.data == "\r"));
    assert!(capture
        .asciicast
        .events
        .iter()
        .any(|event| event.code == "r" && event.data == "40x10"));
}

#[test]
fn retains_settled_repaints_scrollback_and_repeated_states_in_order() {
    let script = r#"
printf '\033[2J\033[Halpha\n'
sleep 0.06
printf '\033[2J\033[Hbeta\n'
sleep 0.06
printf '\033[2J\033[Halpha\n'
"#;

    let capture = capture_terminal(shell_options(script)).expect("capture should complete");
    let states: Vec<&str> = capture
        .frames
        .iter()
        .filter_map(|frame| frame.lines.first().map(String::as_str))
        .collect();

    assert_eq!(states, vec!["alpha", "beta", "alpha"]);
    assert_eq!(capture.transcript, "alpha\nbeta\nalpha");
}

#[test]
fn writes_replay_artifacts_and_preserves_partial_capture_on_timeout() {
    let artifacts = tempdir().expect("artifact directory");
    let mut options = shell_options("printf 'waiting for input'; sleep 5");
    options.timeout = Duration::from_millis(100);
    options.artifact_directory = Some(artifacts.path().into());

    let error = capture_terminal(options).expect_err("capture should time out");
    let partial = error.partial_capture().expect("partial capture");

    assert!(partial.output.contains("waiting for input"));
    for name in [
        "transcript.txt",
        "frames.json",
        "session.cast",
        "snapshot.svg",
        "recording.svg",
    ] {
        assert!(artifacts.path().join(name).is_file(), "{name}");
    }
    let animation =
        fs::read_to_string(artifacts.path().join("recording.svg")).expect("animation");
    assert!(animation.contains("<animate"));
}
