//! Write `recording.gif` (and the other selected artifacts) for a short TUI
//! session: `cargo run --example terminal_gif_preview -- <directory>`.
use command_stream::terminal::{capture_terminal, TerminalArtifact, TerminalCaptureOptions};
use std::time::Duration;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "terminal-artifacts".into());
    let capture = capture_terminal(TerminalCaptureOptions {
        file: "/bin/sh".into(),
        args: vec![
            "-c".into(),
            "printf 'command-stream ┌──┐ █▓▒░ é\\n'; sleep 0.3; printf '\\033[2J\\033[H$ ls\\nREADME.md  src  tests\\n'".into(),
        ],
        cols: 40,
        aspect_ratio: Some(4.0 / 3.0),
        settle_duration: Duration::from_millis(20),
        artifact_directory: Some(directory.clone().into()),
        artifacts: Some(vec![TerminalArtifact::Gif, TerminalArtifact::Transcript]),
        ..TerminalCaptureOptions::default()
    })?;
    println!("{} frames written to {directory}", capture.frames.len());
    Ok(())
}
