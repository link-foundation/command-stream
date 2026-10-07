# Dependency update verification

Run the registry freshness policy and its offline regression suite:

```sh
bun scripts/check-dependencies.mjs
bun test js/tests/dependency-freshness.test.mjs --timeout 10000
```

Before the dependency updates, the registry check reported 61 stale
declarations across the npm package, Rust crate, Rust benchmark package, and
embedded release-script manifests. The final check also includes pinned CI
package installations and npm's publishing major.

Verify the issue's fresh-consumer scenario without publishing a package:

```sh
python3 experiments/issue-204/check-consumer.py
```

The finite probe creates a temporary crate depending on this checkout and
the latest nix, vt100, and which releases. Cargo metadata must resolve each
of those consumer dependencies to the exact same crate ID as command-stream's
direct dependency. Pass `--rust-root /path/to/older/checkout/rust` to reproduce
the old direct-dependency mismatch.

`cargo tree -d` still shows nix 0.28.0 under portable-pty 0.9.0, alongside the
shared current nix 0.31.3. portable-pty 0.9.0 is its latest stable release;
eliminating that remaining transitive duplicate requires an upstream update
or a separate replacement of the PTY backend. No duplicate vt100 or which
remains. The PR records this limit rather than claiming a duplicate-free graph.

## Windows cancellation probe

The Windows job for run 37546397534 stalled in
`child_handle_can_stop_the_process`; its log reported the test running for over
60 seconds at line 1208 before the 30-minute job limit cancelled it. Compilation
and the other native-child test had already passed.

Run the bounded native-child regression tests, including eight attempts for
each cancellation path on Windows:

```sh
cargo test --manifest-path rust/Cargo.toml --all-features --test child_access -- --nocapture
```

Each native-child check runs in a separate test process with a ten-second
deadline. The probe enables `COMMAND_STREAM_TRACE` only in that subprocess.
The retained runner traces distinguish taskkill startup/completion, direct-child
termination, output draining, and process exit. Production tracing remains off
by default.
