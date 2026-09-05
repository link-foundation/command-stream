#![cfg(unix)]

use command_stream::terminal::{
    capture_terminal, open_terminal, read_asciicast, TerminalCaptureOptions, TerminalInteraction,
    TerminalKey, TerminalPattern, TerminalResize,
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
        timeout: Some(Duration::from_secs(3)),
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
            after: None,
            after_regex: Some(r"ready:\d+ \d+".into()),
            idle_duration: Duration::from_millis(30),
            text: Some("hello".into()),
            key: Some(TerminalKey::Enter),
            resize: None,
        },
        TerminalInteraction {
            after: Some("waiting-resize".into()),
            after_regex: None,
            idle_duration: Duration::ZERO,
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
    assert!(
        capture
            .asciicast
            .events
            .iter()
            .find(|event| event.code == "i")
            .expect("input event")
            .time
            >= 0.02
    );
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
fn retains_a_state_when_a_later_repaint_is_split_across_output_chunks() {
    let mut options = shell_options(
        "printf '\\033[2J\\033[Hfirst-state'; sleep 0.02; printf '\\033[2'; \
         sleep 0.02; printf 'J\\033[Hsecond-state'",
    );
    options.settle_duration = Duration::from_millis(100);

    let capture = capture_terminal(options).expect("capture should complete");

    assert_eq!(capture.transcript, "first-state\nsecond-state");
}

#[test]
fn retains_lines_after_they_scroll_off_the_visible_terminal() {
    let mut options = shell_options(
        "printf 'one\\r\\n'; sleep 0.04; printf 'two\\r\\n'; sleep 0.04; \
         printf 'three\\r\\n'; sleep 0.04; printf 'four\\r\\n'",
    );
    options.rows = 2;

    let capture = capture_terminal(options).expect("capture should complete");

    for line in ["one", "two", "three", "four"] {
        assert!(
            capture.transcript.lines().any(|seen| seen == line),
            "{line}"
        );
    }
}

#[test]
fn writes_replay_artifacts_and_preserves_partial_capture_on_timeout() {
    let artifacts = tempdir().expect("artifact directory");
    let mut options = shell_options("printf 'waiting for input'; sleep 5");
    options.timeout = Some(Duration::from_millis(100));
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
    let animation = fs::read_to_string(artifacts.path().join("recording.svg")).expect("animation");
    assert!(animation.contains("<animate"));
    let cast = read_asciicast(artifacts.path().join("session.cast")).expect("asciicast");
    assert_eq!(cast.header.version, 2);
    assert!(cast.events.iter().any(|event| event.code == "o"));
}

#[test]
fn keeps_a_session_open_for_input_that_arrives_later() {
    let script = r#"
printf 'auth-url: https://example.test/device?code=42\n'
IFS= read -r code
printf 'logged-in:%s\n' "$code"
"#;
    let mut session = open_terminal(shell_options(script)).expect("session opens");
    session
        .wait_for(
            &TerminalPattern::regex(r"auth-url: (\S+)").expect("valid regex"),
            Duration::from_millis(30),
            None,
        )
        .expect("auth url arrives");
    assert!(session
        .output()
        .contains("https://example.test/device?code=42"));

    // The code only becomes available much later; nothing may kill the child.
    std::thread::sleep(Duration::from_millis(400));
    assert!(session.running());

    session
        .send(&TerminalInteraction {
            text: Some("42".into()),
            key: Some(TerminalKey::Enter),
            ..TerminalInteraction::default()
        })
        .expect("code is typed");
    session
        .wait_for(
            &TerminalPattern::text("logged-in:42"),
            Duration::ZERO,
            Some(Duration::from_secs(5)),
        )
        .expect("login completes");

    let capture = session.close().expect("session closes");
    assert_eq!(capture.exit_code, 0);
    assert!(capture.transcript.contains("logged-in:42"));
    assert!(capture
        .asciicast
        .events
        .iter()
        .any(|event| event.code == "i"));
}

#[test]
fn reports_wait_for_timeouts_and_sends_after_exit() {
    let mut session = open_terminal(shell_options("printf 'bye\\n'")).expect("session opens");
    let failure = session
        .wait_for(
            &TerminalPattern::text("never-printed"),
            Duration::ZERO,
            Some(Duration::from_millis(100)),
        )
        .expect_err("wait_for gives up");
    assert!(
        failure.to_string().contains("timed out")
            || failure.to_string().contains("terminal exited"),
        "unexpected error: {failure}"
    );

    let capture = session.close().expect("session closes");
    assert!(capture.transcript.contains("bye"));
}

#[test]
fn closes_a_child_that_never_exits_on_its_own() {
    let mut session = open_terminal(shell_options(
        "printf 'waiting for input\\n'; while true; do sleep 0.05; done",
    ))
    .expect("session opens");
    session
        .wait_for(
            &TerminalPattern::text("waiting for input"),
            Duration::ZERO,
            Some(Duration::from_secs(5)),
        )
        .expect("prompt arrives");
    let capture = session.close().expect("session closes");
    assert!(capture.transcript.contains("waiting for input"));
}

#[test]
fn requires_a_file_for_both_entry_points() {
    let options = TerminalCaptureOptions::default();
    assert!(capture_terminal(options.clone())
        .expect_err("capture rejects an empty file")
        .to_string()
        .contains("capture_terminal requires a file"));
    assert!(open_terminal(options)
        .err()
        .expect("session rejects an empty file")
        .to_string()
        .contains("open_terminal requires a file"));
}
