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
}
```

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
