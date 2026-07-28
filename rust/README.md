# command-stream for Rust

[![crates.io](https://img.shields.io/crates/v/command-stream.svg)](https://crates.io/crates/command-stream)
[![Rust CI](https://github.com/link-foundation/command-stream/actions/workflows/rust.yml/badge.svg)](https://github.com/link-foundation/command-stream/actions/workflows/rust.yml)
[![License](https://img.shields.io/badge/license-Unlicense-blue.svg)](../LICENSE)

Rust implementation of command-stream: a shell command execution library with
streaming, events, shell parsing, virtual commands, and built-in command support.

## Installation

```bash
cargo add command-stream
```

## Library Usage

```rust
use command_stream::CommandResult;
use command_stream::commands::echo::EchoCommand;
use command_stream::commands::VirtualCommand;

#[tokio::main]
async fn main() {
    let command = EchoCommand;
    let result: CommandResult = command
        .execute(&["hello".to_string(), "from".to_string(), "rust".to_string()], None)
        .await
        .expect("echo should run");

    assert_eq!(result.stdout.trim(), "hello from rust");

    // `exit_code()` is an alias for the `code` field, mirroring the
    // JavaScript `exitCode` alias.
    assert_eq!(result.exit_code(), result.code);
}
```

## Streaming

`StreamingRunner` streams output as it arrives and mirrors the JavaScript
`stream()` async iterator (issue #155):

```rust
use command_stream::{OutputChunk, StreamingRunner};

#[tokio::main]
async fn main() {
    // `kill_signal` configures the stop signal (default SIGTERM), just like the
    // JavaScript `killSignal` option.
    let runner = StreamingRunner::new("sh -c 'while true; do echo tick; sleep 0.1; done'")
        .kill_signal("SIGINT");
    let mut stream = runner.stream();

    let mut count = 0;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(data) => {
                print!("{}", String::from_utf8_lossy(&data));
                count += 1;
                if count >= 3 {
                    stream.kill(); // stop from inside the loop (uses SIGINT)
                }
            }
            OutputChunk::Stderr(_) => {}
            // A terminating exit chunk is always delivered (128 + signal => 130).
            OutputChunk::Exit(code) => println!("exit: {code}"),
        }
    }
}
```

Parity guarantees with the JavaScript implementation:

- The stream yields a final `OutputChunk::Exit(code)` when the process exits.
- It never hangs when the process has exited but a grandchild keeps the stdio
  pipes open — readers are drained for `exit_pump_grace_ms` (default 100ms) and
  then aborted.
- The process can be stopped from inside the loop with `stream.kill()` (configured
  signal) or `stream.kill_with(signal)` (explicit override); dropping the stream
  (e.g. `break`) stops the process too.

## Command Line

The crate also builds a `command-stream` binary:

```bash
cargo run -- echo hello
```

## TUI Capture

`capture_terminal` runs an interactive program in a real pseudoterminal and
uses `vt100` to retain settled terminal states:

```rust
use command_stream::terminal::{
    capture_terminal, TerminalCaptureOptions, TerminalInteraction, TerminalKey,
};

let capture = capture_terminal(TerminalCaptureOptions {
    file: "codex".into(),
    args: vec!["--no-alt-screen".into()],
    interactions: vec![TerminalInteraction {
        after_regex: Some("Ready: .+".into()),
        idle_duration: std::time::Duration::from_millis(50),
        text: Some("Inspect the failing test".into()),
        key: Some(TerminalKey::Enter),
        ..TerminalInteraction::default()
    }],
    artifact_directory: Some("artifacts/codex".into()),
    ..TerminalCaptureOptions::default()
})?;

println!("{}", capture.transcript);
# Ok::<(), command_stream::terminal::TerminalCaptureError>(())
```

The capture contains the raw PTY output, consecutive-deduplicated frames, an
ordered unrolled transcript, and asciicast v2 input/output/resize events. The
artifact directory receives `transcript.txt`, `frames.json`, `session.cast`,
`snapshot.svg`, and an animated `recording.svg`; timeout errors retain the
partial capture and those diagnostic files. Use `capture_terminal_async` from
an async application.

Interactions can wait for literal output with `after`, regex output with
`after_regex`, and output quiescence with `idle_duration`. Named
`TerminalKey` variants cover arrows, Enter, Tab, Escape, Backspace, Ctrl-C, and
Ctrl-D; use `TerminalKey::Raw` for any other escape sequence.

## Features

- Shell parser for pipelines, command lists, logical operators, and redirection.
- Built-in command implementations for file-system and shell utility commands.
- Async execution with `tokio`.
- Virtual command abstractions for embedding command behavior in Rust programs.
- Cross-platform tests covering parser, state, events, streams, and built-ins.

## Development

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-features
cargo test --doc --all-features
cargo package --allow-dirty
```

Rust release automation lives in [scripts/](scripts/) and is controlled by
`.github/workflows/rust.yml` from the repository root.
