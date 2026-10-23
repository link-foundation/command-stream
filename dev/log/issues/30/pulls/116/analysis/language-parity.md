# Language parity follow-up

The review at https://github.com/link-foundation/command-stream/pull/116#issuecomment-6125839043
requires substantive JavaScript and Rust support without `parity-exempt`.
Rust's existing typed package API lacked registry discovery, manifest installation
identity, npm resolution, and an in-process manifest watcher. It also had actual
collision and composition bugs. The follow-up extends the existing API and
preserves its typed handlers and built-in commands.

## Reproduced failures

Run `cargo test --manifest-path rust/Cargo.toml --test command_packages` against
the initial implementation with the regression tests present. Installation
accepted a package overwriting built-in `echo`, and composition dropped the
supplied cancellation check. The preserved `rust-parity-before.log.gz` shows
both failing assertions. The implementation now validates every command before
changing the registry and shares cancellation across composed stages. Streaming
intermediate output is drained concurrently into the next stage's stdin.

Run `cargo test --manifest-path rust/Cargo.toml --test package_streaming` against
the initial streaming manifest draft. Decoding each byte chunk independently
changed split `é` into replacement characters, while a full bounded output
channel prevented the cancellation loop from executing. The preserved
`rust-streaming-before.log.gz` shows both failures. An incremental decoder retains
incomplete code points, and sends select against cancellation. Both reproductions
use a finite child process, bounded channels and explicit test deadlines.

## Portable contracts

JavaScript registers generators and module exports; Rust registers typed async
closures and literal-argv manifests. Both support packages, install/create/extend,
inheritance, middleware, composition, incremental output, real marketplace search,
and development reload. Non-string names cannot compile in Rust; compile-fail
doctests and invalid-string tests protect its interface.

Rust's npm installation resolves `command-stream.json`, allowing providers to
ship a JavaScript module and a Rust-compatible manifest in one npm package.
Arbitrary JavaScript function exports require a typed Rust counterpart or an
executable manifest command. This provider format is explicit in both guides.
Rust registry discovery uses curl by default and also accepts an injected async
transport. Tests exercise the real transport against local HTTP servers and
real npm installation from a local offline dependency.

Ten typed Rust package examples and two runnable demonstrations complement the
existing JavaScript catalog. Expanded executable feature comparisons cover name
validation, composition, atomic reload and discovery metadata in Rust, Node and
Bun. No external publication or production deployment is performed or claimed.
