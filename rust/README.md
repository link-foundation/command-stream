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
