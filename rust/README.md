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

    // `error_for_status()` turns a failing result into an error, whose status
    // reads through the same pair of names.
    let error = CommandResult::error_with_code("boom", 2)
        .error_for_status()
        .unwrap_err();
    assert_eq!(error.code(), Some(2));
    assert_eq!(error.exit_code(), error.code());
}
```

### Successful CLI output on stderr

Command-stream preserves the file descriptor chosen by the child process. A
zero exit code can therefore accompany an empty `stdout` and useful `stderr`.
Check both when a CLI version may print a machine-readable result, such as a
new pull request URL, to stderr:

```rust,no_run
use command_stream::run;

# async fn example() -> Result<(), command_stream::Error> {
let result = run("gh pr create --fill").await?;
let pull_request_url = result
    .stdout
    .lines()
    .chain(result.stderr.lines())
    .find(|line| line.starts_with("https://github.com/"));
# let _ = pull_request_url;
# Ok(())
# }
```

Append `2>&1` to the command when normal shell stream merging is preferred. The
merged output is captured in `stdout`, while `stderr` is empty.

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

`StreamingRunner::new(command)` interprets a completed command string with the
platform shell. When argument boundaries must be preserved exactly, pass the
executable and arguments separately with `from_argv`:

```rust,no_run
use command_stream::StreamingRunner;

#[tokio::main]
async fn main() -> command_stream::Result<()> {
    let runner = StreamingRunner::from_argv(
        "my-program",
        ["argument with spaces", "literal&metacharacters"],
    );
    let result = runner.collect().await?;

    assert!(result.is_success());
    Ok(())
}
```

The exact-argv form bypasses `/bin/sh -c` and `cmd.exe /c`, so it does not
require shell-specific quoting. It also accepts OS-native executable and
argument values such as `PathBuf` and `OsString`.

## Signals

`kill()` stops a running command. It defaults to `SIGTERM` and works the same way
for both runners, matching the JavaScript implementation
([JS signal documentation](../js/README.md#sending-signals-to-a-running-command)).

### What `kill()` actually does

Stopping a process is not a single signal. Every kill runs the same four steps:

1. The requested signal is delivered to the child **and its process group**, so a
   grandchild behind a shell wrapper is reached too.
2. The child is given a grace period (`kill_grace_ms`, default `100`) to run its
   own signal handler and exit on its own terms.
3. If it is still alive when the grace period expires, `SIGKILL` follows, so a
   process that ignores the signal is still guaranteed to terminate.
4. The reported exit code is the conventional `128 + signal` value.

Step 2 is what makes a shutdown _graceful_: without it, a child that traps
SIGTERM to flush output, release a lock, or stop its own workers is destroyed
before its handler can run.

### Grandchildren and process groups

Commands run through a shell, so the real work is usually a grandchild of the
`sh` that was spawned. Both runners therefore start the child in its own process
group and signal the group, not just the direct child — including the common
case where the wrapper dies on the first signal and the grandchild is reparented
to init.

The one exception is a command that shares your terminal: when `interactive` is
set, or when stdin is inherited and is a tty, `ProcessRunner` leaves the child in
the caller's process group. It has to, because the terminal delivers CTRL+C to
its foreground group only, and a background child that read from the terminal
would be stopped with SIGTTIN. For those commands the signal reaches the direct
child alone — and CTRL+C from the terminal already reaches the whole group
anyway. Set `stdin` to `StdinOption::Null` or `StdinOption::Pipe` if you need
group delivery from `kill()`.

### ProcessRunner

`kill()` sends the configured signal; `kill_with(signal)` overrides it for a
single call:

```rust,no_run
use command_stream::{ProcessRunner, RunOptions};

#[tokio::main]
async fn main() -> command_stream::Result<()> {
    let mut runner = ProcessRunner::new(
        "sh -c 'trap \"echo cleaning up; exit 0\" TERM; while true; do sleep 1; done'",
        RunOptions {
            // The signal an argument-less kill() delivers (default SIGTERM).
            kill_signal: "SIGTERM".to_string(),
            // Time the child gets to handle it before SIGKILL (default 100ms).
            kill_grace_ms: 100,
            ..Default::default()
        },
    );

    runner.start().await?;
    runner.kill()?; // the trap runs, prints "cleaning up", and exits
    runner.kill_with("SIGINT")?; // explicit per-call override

    Ok(())
}
```

### StreamingRunner

`stream.kill()` and `stream.kill_with(signal)` stop the process from inside the
loop; dropping the stream (e.g. `break`) stops it too:

```rust,no_run
use command_stream::{OutputChunk, StreamingRunner};

#[tokio::main]
async fn main() {
    let mut stream = StreamingRunner::new("sh -c 'while true; do echo tick; sleep 0.1; done'")
        .kill_signal("SIGINT") // default for kill() and for dropping the stream
        .kill_grace_ms(100) // grace before the SIGKILL escalation
        .stream();

    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(_) => stream.kill(), // sends SIGINT
            OutputChunk::Exit(code) => println!("exit: {code}"), // 130
            OutputChunk::Stderr(_) => {}
        }
    }
}
```

### Tuning the grace period

`kill_grace_ms` is the number of milliseconds between the requested signal and
the SIGKILL escalation. Set it to `0` to escalate immediately, with no chance to
clean up: the requested signal is then not delivered at all, only `SIGKILL`.
Delivering it first and then killing would leave a window the child can be
scheduled in, which makes "no grace" a race rather than a guarantee. The
reported exit code still reflects the signal you requested.

`SIGKILL` is never delayed: it cannot be caught, so `kill_with("SIGKILL")` skips
the grace period regardless of the configured value.

### Signal exit codes

A process stopped by a signal reports `128 + signal`, the same convention POSIX
shells use. `signal_number` and `signal_exit_code` expose the mapping:

```rust
use command_stream::{signal_exit_code, signal_number};

assert_eq!(signal_number("SIGINT"), 2);
assert_eq!(signal_exit_code("SIGINT"), 130); // CTRL+C
assert_eq!(signal_exit_code("SIGTERM"), 143);
assert_eq!(signal_exit_code("SIGKILL"), 137);
```

| Signal    | Number | Exit code | Typical meaning                      |
| --------- | ------ | --------- | ------------------------------------ |
| `SIGHUP`  | 1      | `129`     | Terminal closed / reload config      |
| `SIGINT`  | 2      | `130`     | CTRL+C                               |
| `SIGQUIT` | 3      | `131`     | Quit from keyboard                   |
| `SIGKILL` | 9      | `137`     | Forced termination, cannot be caught |
| `SIGUSR1` | 10     | `138`     | Application-defined                  |
| `SIGUSR2` | 12     | `140`     | Application-defined                  |
| `SIGTERM` | 15     | `143`     | Polite request to stop (the default) |

The code reflects the signal **you requested**, even when the SIGKILL escalation
is what ultimately stopped the process. Unknown signal names fall back to
`SIGTERM`. Signals are a Unix concept; on Windows the escalation terminates the
process directly.

## Multiline Text and Exact Output

The command macros treat an interpolated multiline string as one literal
argument. Shell metacharacters remain data, and captured stdout/stderr preserve
whether the child emitted a final newline:

```rust,no_run
use command_stream::s;

# async fn example() -> Result<(), command_stream::Error> {
let content = "# Generated\n\nLiteral: `code`, $HOME, ${name}, and C:\\Tools";
let result = s!("printf '%s' {}", content).await?;
assert_eq!(result.stdout, content);
# Ok(())
# }
```

Use `printf '%s'` instead of `echo` when exact text matters; `echo` normally
adds a trailing newline. If no command is involved, prefer `std::fs::write`.

## GitHub CLI Markdown Bodies

The same literal-argument contract applies to complex issue bodies. No manual
escaping is needed for fenced code, `${...}` text, quotes, shell-looking
syntax, backslashes, newlines, or Unicode:

````rust,no_run
use command_stream::s;

# async fn example() -> Result<(), command_stream::Error> {
let repository = "owner/repository";
let title = "Bug report";
let body = "## Reproduction\n\n```rust\nlet message = \"literal ${value}\";\n```\n\n\
            $HOME and $(whoami) are documentation, not shell syntax.";

let result = s!(
    "gh issue create --repo {} --title {} --body {}",
    repository,
    title,
    body,
)
.await?;
assert!(result.is_success());
# Ok(())
# }
````

If the text already lives in a file, use GitHub CLI's `--body-file` option.
For platform-native argument handling without a shell, pass the same values to
`StreamingRunner::from_argv`.

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

### Interactive sessions

`capture_terminal` is batch-only: every interaction is known up front and
`timeout` (30 s by default) kills the child. When the input arrives later and
from elsewhere — an authorization code a human pastes back minutes later, a
chat-ops bridge, a test that interleaves assertions with input — use
`open_terminal`, which keeps the same PTY open until you close it:

```rust,no_run
use command_stream::terminal::{
    open_terminal, TerminalCaptureOptions, TerminalInteraction, TerminalKey, TerminalPattern,
};
use std::time::Duration;

let mut session = open_terminal(TerminalCaptureOptions {
    file: "my-cli".into(),
    args: vec!["login".into()],
    ..TerminalCaptureOptions::default()
})?;

session.wait_for(
    &TerminalPattern::regex(r"https://\S+")?,
    Duration::from_millis(50),
    None,
)?;
let url = session.transcript();

// ... arbitrary time passes; nothing terminates the child ...

session.send(&TerminalInteraction {
    text: Some("ABCD-1234".into()),
    key: Some(TerminalKey::Enter),
    ..TerminalInteraction::default()
})?;
session.wait_for(&TerminalPattern::text("Logged in"), Duration::ZERO, None)?;

let capture = session.close()?;
# let _ = (url, capture);
# Ok::<(), command_stream::terminal::TerminalCaptureError>(())
```

`open_terminal` accepts every `capture_terminal` option and forces
`timeout: None`, so a session runs until the child exits or `close()` is called.
`wait_for` reuses the same readiness semantics as `interactions`, including the
idle wait, and fails when the child exits first or its own timeout elapses.
`send` uses the `TerminalInteraction` vocabulary, `close` stops the child and
returns the usual capture (writing `artifact_directory` artifacts), and `finish`
waits for a child that exits on its own. `capture_terminal` is implemented on
top of the same session, so the two paths cannot drift.

Interactions can wait for literal output with `after`, regex output with
`after_regex`, and output quiescence with `idle_duration`. Named
`TerminalKey` variants cover arrows, Enter, Tab, Escape, Backspace, Ctrl-C, and
Ctrl-D; use `TerminalKey::Raw` for any other escape sequence. An interaction
must contain at least one action or wait; an empty `TerminalInteraction` is
rejected before the terminal is opened or input is sent.

### Built-in `tee`

`tee` copies its input to stdout and to every file it is given, so a pipeline
can be recorded and keep flowing. It follows GNU coreutils: `-a`/`--append`
appends instead of truncating, `-i`/`--ignore-interrupts` keeps writing when
the pipeline is cancelled, `--` ends option parsing, and a bare `-` is a file
named `-` rather than stdout. A write failure is reported on stderr and sets
exit code 1, while the remaining files are still written.

```rust,no_run
use command_stream::Pipeline;

#[tokio::main]
async fn main() {
    let result = Pipeline::new()
        .add("echo deploying")
        .add("tee deploy.log")
        .run()
        .await
        .expect("pipeline should run");

    assert_eq!(result.stdout, "deploying\n");
}
```

Built-in commands receive their stdin as one completed buffer, because a
pipeline reads each upstream stage to the end before handing the result on. So
`tee` is a pipeline stage, not a live terminal filter; for an interactive `tee`,
use the PTY sessions described under [Interactive sessions](#interactive-sessions).

## Features

### Tracked compatibility corpus

The Rust tests track the native process API plus Tokio, async-process,
assert_cmd, duct, xshell, subprocess, rust_cmd_lib, run_script, bkt,
rust-shell, shellfn, rexpect, and expectrl. All fourteen upstream suites are
pinned to immutable commits. Portable public behavior runs against
command-stream, while unsupported capabilities and inapplicable
competitor-specific tests are accounted for in the
[competitor test corpus audit](docs/COMPETITOR_TEST_AUDIT.md).

Run the focused executable corpus with
`cargo test --test competitor_compatibility`.

The [Rust benchmark playground](benchmarks/README.md) turns six of those native
process-library mappings into validated performance, crate-footprint,
feature-coverage, and real-world comparisons. Its CI-sized profile is:

```bash
cargo run --release --locked --manifest-path benchmarks/Cargo.toml -- --smoke
```

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
