use super::raster::render_recording_gif;
use super::types::{
    Asciicast, AsciicastEvent, AsciicastHeader, TerminalArtifact, TerminalCaptureError,
    TerminalFrame,
};
use std::fs;
use std::path::Path;

fn trim_blank_edges(lines: &[String]) -> &[String] {
    let first = lines
        .iter()
        .position(|line| !line.is_empty())
        .unwrap_or(lines.len());
    let last = lines
        .iter()
        .rposition(|line| !line.is_empty())
        .map_or(first, |index| index + 1);
    &lines[first..last]
}

fn overlap_length(previous: &[String], current: &[String]) -> usize {
    let maximum = previous.len().min(current.len());
    (1..=maximum)
        .rev()
        .find(|size| previous[previous.len() - size..] == current[..*size])
        .unwrap_or(0)
}

pub fn unroll_terminal_frames(frames: &[TerminalFrame]) -> String {
    let mut transcript = Vec::new();
    let mut previous: &[String] = &[];

    for frame in frames {
        let current = trim_blank_edges(&frame.lines);
        if current == previous {
            continue;
        }

        let overlap = overlap_length(previous, current);
        if overlap > 0 {
            transcript.extend_from_slice(&current[overlap..]);
        } else {
            let common_prefix = previous
                .iter()
                .zip(current)
                .take_while(|(left, right)| left == right)
                .count();
            transcript.extend_from_slice(&current[common_prefix..]);
        }
        previous = current;
    }

    trim_blank_edges(&transcript).join("\n")
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn svg_text(lines: &[String]) -> String {
    lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            format!(
                r#"<text x="12" y="{}">{}</text>"#,
                24 + index * 18,
                escape_xml(if line.is_empty() { " " } else { line })
            )
        })
        .collect()
}

fn svg_shell(width: usize, height: usize, body: &str) -> String {
    format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8"?>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{0}" height="{1}" viewBox="0 0 {0} {1}">"#,
            r##"<rect width="100%" height="100%" rx="6" fill="#111827"/>"##,
            r##"<g fill="#e5e7eb" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">"##,
            "{2}</g></svg>"
        ),
        width, height, body
    )
}

fn render_snapshot_svg(frame: &TerminalFrame) -> String {
    svg_shell(
        usize::from(frame.cols) * 9 + 24,
        usize::from(frame.rows) * 18 + 18,
        &svg_text(&frame.screen),
    )
}

fn render_recording_svg(frames: &[TerminalFrame]) -> String {
    let columns = frames.iter().map(|frame| frame.cols).max().unwrap_or(1);
    let rows = frames.iter().map(|frame| frame.rows).max().unwrap_or(1);
    let count = frames.len().max(1);
    let key_times = (0..=count)
        .map(|index| (index as f64 / count as f64).to_string())
        .collect::<Vec<_>>()
        .join(";");
    let duration = (count as f64 * 0.35).max(0.35);
    let groups = frames
        .iter()
        .enumerate()
        .map(|(frame_index, frame)| {
            let values = (0..=count)
                .map(|index| {
                    if index == frame_index || (index == count && frame_index == 0) {
                        "1"
                    } else {
                        "0"
                    }
                })
                .collect::<Vec<_>>()
                .join(";");
            format!(
                concat!(
                    "<g>",
                    r#"<animate attributeName="opacity" calcMode="discrete" values="{}" keyTimes="{}" dur="{}s" repeatCount="indefinite"/>"#,
                    "{}</g>"
                ),
                values,
                key_times,
                duration,
                svg_text(&frame.screen)
            )
        })
        .collect::<String>();
    svg_shell(
        usize::from(columns) * 9 + 24,
        usize::from(rows) * 18 + 18,
        &groups,
    )
}

pub fn serialize_asciicast(asciicast: &Asciicast) -> Result<String, TerminalCaptureError> {
    let mut lines = vec![serde_json::to_string(&asciicast.header)
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?];
    for event in &asciicast.events {
        lines.push(
            serde_json::to_string(&(event.time, &event.code, &event.data))
                .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?,
        );
    }
    Ok(format!("{}\n", lines.join("\n")))
}

pub fn read_asciicast(path: impl AsRef<Path>) -> Result<Asciicast, TerminalCaptureError> {
    let contents = fs::read_to_string(path)
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
    let mut lines = contents.lines();
    let header: AsciicastHeader = serde_json::from_str(
        lines
            .next()
            .ok_or_else(|| TerminalCaptureError::new("empty asciicast", None))?,
    )
    .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
    let events = lines
        .filter(|line| !line.is_empty())
        .map(|line| {
            let (time, code, data): (f64, String, String) = serde_json::from_str(line)
                .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
            Ok(AsciicastEvent { time, code, data })
        })
        .collect::<Result<Vec<_>, TerminalCaptureError>>()?;
    Ok(Asciicast { header, events })
}

/// Write the `selected` artifacts (all of them for `None`) to `directory`.
/// Each renderer runs only when its artifact is selected.
pub(crate) fn write_terminal_artifacts(
    directory: &Path,
    selected: Option<&[TerminalArtifact]>,
    frames: &[TerminalFrame],
    transcript: &str,
    asciicast: &Asciicast,
) -> Result<(), TerminalCaptureError> {
    fs::create_dir_all(directory)
        .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
    let fallback = [TerminalFrame {
        time: 0.0,
        cols: asciicast.header.width,
        rows: asciicast.header.height,
        cursor: super::types::TerminalCursor { x: 0, y: 0 },
        alternate: false,
        lines: Vec::new(),
        screen: Vec::new(),
    }];
    let rendered = if frames.is_empty() { &fallback } else { frames };
    let final_frame = &rendered[rendered.len() - 1];
    let mut written = Vec::new();
    for artifact in selected.unwrap_or(&TerminalArtifact::ALL) {
        if written.contains(artifact) {
            continue;
        }
        written.push(*artifact);
        let contents = match artifact {
            TerminalArtifact::Transcript => format!("{transcript}\n").into_bytes(),
            TerminalArtifact::Frames => format!(
                "{}\n",
                serde_json::to_string_pretty(frames)
                    .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?
            )
            .into_bytes(),
            TerminalArtifact::Cast => serialize_asciicast(asciicast)?.into_bytes(),
            TerminalArtifact::Snapshot => render_snapshot_svg(final_frame).into_bytes(),
            TerminalArtifact::Recording => render_recording_svg(frames).into_bytes(),
            TerminalArtifact::Gif => render_recording_gif(rendered)?,
        };
        fs::write(directory.join(artifact.file_name()), contents)
            .map_err(|error| TerminalCaptureError::new(error.to_string(), None))?;
    }
    Ok(())
}
