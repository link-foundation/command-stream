use command_stream::{quote, CommandResult, StreamingRunner};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use tempfile::TempDir;

struct Fixture {
    _directory: TempDir,
    executable: PathBuf,
}

static FIXTURE: OnceLock<Fixture> = OnceLock::new();

pub fn fixture_path() -> &'static Path {
    &FIXTURE
        .get_or_init(|| {
            let directory = tempfile::tempdir().expect("create fixture directory");
            let executable = directory.path().join(format!(
                "competitor-process{}",
                std::env::consts::EXE_SUFFIX
            ));
            let source = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/competitor_compatibility/fixture.rs");
            let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc"));
            let output = Command::new(rustc)
                .args(["--edition=2021"])
                .arg(source)
                .arg("-o")
                .arg(&executable)
                .output()
                .expect("run rustc for process fixture");
            assert!(
                output.status.success(),
                "fixture compilation failed:\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            Fixture {
                _directory: directory,
                executable,
            }
        })
        .executable
}

pub fn fixture_runner(mode: &str, args: &[&str]) -> StreamingRunner {
    StreamingRunner::from_argv(
        fixture_path(),
        std::iter::once(mode).chain(args.iter().copied()),
    )
}

pub async fn run_fixture(mode: &str, args: &[&str]) -> CommandResult {
    fixture_runner(mode, args)
        .collect()
        .await
        .expect("fixture should start")
}

pub fn shell_fixture_command(mode: &str, args: &[&str]) -> String {
    let executable = fixture_path().to_string_lossy();
    let mut words = Vec::with_capacity(args.len() + 2);
    words.push(shell_word(&executable));
    words.push(shell_word(mode));
    words.extend(args.iter().map(|arg| shell_word(arg)));
    words.join(" ")
}

#[cfg(not(windows))]
fn shell_word(value: &str) -> String {
    quote(value)
}

#[cfg(windows)]
fn shell_word(value: &str) -> String {
    if value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'/' | b'\\' | b':')
    }) {
        value.to_string()
    } else {
        format!("\"{}\"", value.replace('"', "\\\""))
    }
}

pub fn decode_hex_lines(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|line| {
            assert_eq!(line.len() % 2, 0, "invalid fixture hex: {line:?}");
            let bytes = (0..line.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&line[index..index + 2], 16).unwrap())
                .collect::<Vec<_>>();
            String::from_utf8(bytes).unwrap()
        })
        .collect()
}

pub fn hex(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
