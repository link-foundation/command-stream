//! Regression tests for issues #229 and #231: the PTY child's environment can
//! drop inherited variables, artifacts can be selected, a GIF is written, rows
//! can follow an aspect ratio, and capture events reach `on_trace`.
#![cfg(unix)]

use command_stream::terminal::{
    capture_terminal, TerminalArtifact, TerminalCaptureOptions, TerminalInteraction, TerminalTrace,
    TerminalTraceCallback, TerminalTraceEvent,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::tempdir;

fn shell_options(script: &str) -> TerminalCaptureOptions {
    TerminalCaptureOptions {
        file: "/bin/sh".into(),
        args: vec!["-c".into(), script.into()],
        cols: 40,
        rows: 6,
        settle_duration: Duration::from_millis(10),
        timeout: Some(Duration::from_secs(5)),
        ..TerminalCaptureOptions::default()
    }
}

fn files_in(directory: &std::path::Path) -> Vec<String> {
    let mut names = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    names.sort();
    names
}

/// The reproduction from issue #229.
#[test]
fn env_remove_drops_an_inherited_variable() {
    std::env::set_var("COMMAND_STREAM_SECRET_TOKEN", "leaked");
    let script = "echo token=${COMMAND_STREAM_SECRET_TOKEN:-unset}";

    let inherited = capture_terminal(shell_options(script)).unwrap();
    assert!(inherited.transcript.contains("token=leaked"));

    let mut options = shell_options(script);
    options.env_remove = vec!["COMMAND_STREAM_SECRET_TOKEN".into()];
    let removed = capture_terminal(options).unwrap();
    assert!(
        removed.transcript.contains("token=unset"),
        "{}",
        removed.transcript
    );
}

#[test]
fn env_remove_applies_after_env() {
    let mut options = shell_options("echo value=${COMMAND_STREAM_BOTH:-unset}");
    options.env = HashMap::from([("COMMAND_STREAM_BOTH".into(), "set".into())]);
    options.env_remove = vec!["COMMAND_STREAM_BOTH".into()];
    let capture = capture_terminal(options).unwrap();
    assert!(capture.transcript.contains("value=unset"));
}

#[test]
fn env_clear_starts_from_an_empty_environment() {
    std::env::set_var("COMMAND_STREAM_CLEARED", "inherited");
    let mut options =
        shell_options("echo \"c=${COMMAND_STREAM_CLEARED:-unset} k=$KEPT t=$TERM l=$LINES\"");
    options.env_clear = true;
    options.env = HashMap::from([("KEPT".into(), "yes".into())]);
    let capture = capture_terminal(options).unwrap();
    assert!(
        capture
            .transcript
            .contains("c=unset k=yes t=xterm-256color l=6"),
        "{}",
        capture.transcript
    );
}

/// The selection from issue #231.
#[test]
fn artifacts_writes_only_the_selected_files() {
    let directory = tempdir().unwrap();
    let mut options = shell_options("echo selected");
    options.artifact_directory = Some(directory.path().into());
    options.artifacts = Some(vec![
        TerminalArtifact::Transcript,
        TerminalArtifact::Snapshot,
    ]);
    capture_terminal(options).unwrap();

    assert_eq!(
        files_in(directory.path()),
        ["snapshot.svg", "transcript.txt"]
    );
    let transcript = std::fs::read_to_string(directory.path().join("transcript.txt")).unwrap();
    assert_eq!(transcript, "selected\n");
}

#[test]
fn artifacts_defaults_to_every_file_including_the_gif() {
    let directory = tempdir().unwrap();
    let mut options = shell_options("echo all");
    options.artifact_directory = Some(directory.path().into());
    capture_terminal(options).unwrap();

    let mut expected = TerminalArtifact::ALL
        .map(TerminalArtifact::file_name)
        .to_vec();
    expected.sort_unstable();
    assert_eq!(files_in(directory.path()), expected);
    let gif = std::fs::read(directory.path().join("recording.gif")).unwrap();
    assert!(gif.starts_with(b"GIF89a"));
}

#[test]
fn an_empty_selection_writes_nothing() {
    let directory = tempdir().unwrap();
    let target = directory.path().join("nested");
    let mut options = shell_options("echo none");
    options.artifact_directory = Some(target.clone());
    options.artifacts = Some(Vec::new());
    capture_terminal(options).unwrap();
    assert!(files_in(&target).is_empty());
}

#[test]
fn artifact_names_match_the_js_option() {
    let names = TerminalArtifact::ALL.map(TerminalArtifact::name);
    assert_eq!(
        names,
        [
            "transcript",
            "frames",
            "cast",
            "snapshot",
            "recording",
            "gif"
        ]
    );
    for artifact in TerminalArtifact::ALL {
        assert_eq!(
            artifact.name().parse::<TerminalArtifact>().unwrap(),
            artifact
        );
    }
    let error = "video".parse::<TerminalArtifact>().unwrap_err();
    assert!(error
        .to_string()
        .contains("unknown terminal artifact \"video\""));
}

#[test]
fn gif_only_selection_renders_every_frame() {
    let directory = tempdir().unwrap();
    let mut options = shell_options("printf one; sleep 0.2; printf '\\033[2J\\033[Htwo'");
    options.artifact_directory = Some(directory.path().into());
    options.artifacts = Some(vec![TerminalArtifact::Gif]);
    let capture = capture_terminal(options).unwrap();

    assert_eq!(files_in(directory.path()), ["recording.gif"]);
    let bytes = std::fs::read(directory.path().join("recording.gif")).unwrap();
    let mut decoder = gif::DecodeOptions::new()
        .read_info(bytes.as_slice())
        .unwrap();
    assert_eq!(
        (decoder.width(), decoder.height()),
        (40 * 8 + 24, 6 * 16 + 24)
    );
    let mut images = 0;
    while decoder.read_next_frame().unwrap().is_some() {
        images += 1;
    }
    assert_eq!(images, capture.frames.len());
    assert!(images >= 2, "both screens are retained");
}

#[test]
fn aspect_ratio_derives_rows_like_js() {
    let mut options = shell_options("echo lines=$LINES; stty size");
    options.cols = 80;
    options.aspect_ratio = Some(4.0 / 3.0);
    let capture = capture_terminal(options).unwrap();
    assert!(
        capture.transcript.contains("lines=30"),
        "{}",
        capture.transcript
    );
    assert!(
        capture.transcript.contains("30 80"),
        "{}",
        capture.transcript
    );
    assert_eq!(capture.asciicast.header.height, 30);
    assert!(capture.frames.iter().all(|frame| frame.rows == 30));
}

#[test]
fn invalid_aspect_ratio_is_rejected() {
    for ratio in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let mut options = shell_options("exit 0");
        options.aspect_ratio = Some(ratio);
        let error = capture_terminal(options).expect_err("ratio must be positive");
        assert!(error.to_string().contains("aspect_ratio"), "{error}");
    }
}

fn recorder() -> (TerminalTraceCallback, Arc<Mutex<Vec<TerminalTrace>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let callback =
        TerminalTraceCallback::new(move |trace| sink.lock().unwrap().push(trace.clone()));
    (callback, events)
}

#[test]
fn on_trace_reports_output_interactions_and_exit() {
    let (callback, events) = recorder();
    let mut options = shell_options("printf 'name? '; IFS= read -r name; printf 'hi %s' \"$name\"");
    options.interactions = vec![TerminalInteraction {
        after: Some("name?".into()),
        text: Some("ada\r".into()),
        ..TerminalInteraction::default()
    }];
    options.on_trace = Some(callback);
    let capture = capture_terminal(options).unwrap();
    assert!(capture.transcript.contains("hi ada"));

    let events = events.lock().unwrap();
    let kinds = events
        .iter()
        .map(|trace| trace.event.kind())
        .collect::<Vec<_>>();
    let position = |kind: &str| kinds.iter().position(|seen| *seen == kind).unwrap();
    assert!(position("output") < position("interaction-scheduled"));
    assert!(position("interaction-scheduled") < position("interaction-applied"));
    assert_eq!(kinds.last(), Some(&"exit"), "{kinds:?}");
    assert_eq!(
        events.last().unwrap().event,
        TerminalTraceEvent::Exit {
            exit_code: 0,
            signal: None
        }
    );
    let output = events
        .iter()
        .filter_map(|trace| match &trace.event {
            TerminalTraceEvent::Output { data } => Some(data.as_str()),
            _ => None,
        })
        .collect::<String>();
    assert_eq!(output, capture.output);
    assert!(events.windows(2).all(|pair| pair[0].time <= pair[1].time));
}

#[test]
fn on_trace_reports_the_timeout() {
    let (callback, events) = recorder();
    let mut options = shell_options("sleep 5");
    options.timeout = Some(Duration::from_millis(100));
    options.on_trace = Some(callback);
    capture_terminal(options).expect_err("capture should time out");

    let events = events.lock().unwrap();
    let kinds = events
        .iter()
        .map(|trace| trace.event.kind())
        .collect::<Vec<_>>();
    assert_eq!(kinds, ["timeout", "exit"]);
    assert_eq!(
        events[0].event,
        TerminalTraceEvent::Timeout {
            timeout_milliseconds: 100
        }
    );
}
