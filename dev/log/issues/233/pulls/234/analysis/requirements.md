# Requirements for issue 233

Issue #233 asks for every open issue (#226–#232) to be resolved in one pull
request whose description closes all of them. Each requirement below is mapped
to its implementation and to the test that reproduces the problem without the
change. Issue bodies are saved in `experiments/issue-233/issues/`.

## #226: crates.io trusted publishing

The policy comment of 2026-10-13 supersedes the plan in the issue body: try
OIDC first, keep `CARGO_REGISTRY_TOKEN`/`CARGO_TOKEN` as the fallback, and do
not delete the token secrets.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Release jobs get `id-token: write` | `release` and `instant-release` in `.github/workflows/rust.yml` | `workflows.yml` lint, diff review |
| `rust-lang/crates-io-auth-action` pinned to `c6f97d42…` (v1.0.5), `continue-on-error: true`, before `publish-crate.rs` | both release jobs | diff review |
| `CARGO_REGISTRY_TOKEN: steps.crates_auth.outputs.token \|\| secrets.CARGO_REGISTRY_TOKEN \|\| secrets.CARGO_TOKEN` | publish steps and the preflight | diff review |
| Credential preflight runs after the auth step, requires an OIDC identity and checks the OIDC token first | `.github/scripts/publish-preflight.mjs` | `js/tests/publish-preflight.test.mjs` |
| Documented | `.github/DEPLOYMENT.md` | docs review |

Registering the trusted publisher on crates.io
(`package-registry-manager setup --registry crates-io --migrate --execute`) is
an account-level action for a maintainer after merge. Until then the token
fallback keeps releases working, which is what the policy asks for.

## #227: `$({ timeout })`

| Requirement | Implementation | Verification |
| --- | --- | --- |
| `timeout` (ms) bounds simple commands, pipelines, `stream()`, exec specs and `.sync()` | `js/src/$.process-runner-timeout.mjs`, execution and pipeline runners | `js/tests/timeout-option.test.mjs` |
| Combined with a caller `signal` | same stop path as an aborted signal | "timeout combines with an external signal" |
| Cause visible as `result.timedOut` | result builders, `types/api.d.cts` | timeout tests, type tests |
| Invalid values rejected with a clear error | `TypeError` on validation | timeout tests |
| Rust parity | `RunOptions::timeout`, `StreamingRunner::timeout`, `timed_out()` in `rust/src/process_stop.rs` | `rust/tests/timeout.rs` |

## #228: non-login shell

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Use `-c` instead of `-l -c` for simple commands, sync mode and pipelines | `js/src/$.shell.mjs` | `js/tests/login-shell.test.mjs` uses the `HOME`/`.profile` reproduction from the issue: `PATH[0]` and stdout are unchanged |
| Login shell becomes opt-in, `loginShell: true` | option threaded through the shell argv builder | same test, opt-in case |
| Documented | `js/README.md` options list | docs validation |

The Rust crate already ran `sh -c`, so it needed no change.

## #229: removing environment variables

| Requirement | Implementation | Verification |
| --- | --- | --- |
| `StreamingRunner::env_remove` / `env_remove_all` | `rust/src/stream.rs`, `stream_process.rs` (`ChildEnv`) | `rust/tests/env_remove.rs` |
| `RunOptions.env_remove: Vec<String>` | `rust/src/run_options.rs`, `lib.rs` | `rust/tests/env_remove.rs` |
| `TerminalCaptureOptions.env_remove` and `env_clear`, forwarded to `portable_pty::CommandBuilder::env_remove`/`env_clear` | `rust/src/terminal/capture.rs` | `rust/tests/terminal_options.rs` (the issue's `SECRET_TOKEN` reproduction) |
| JS: `undefined` values remove a variable | process env resolution and the `env` built-in | `js/tests/env-undefined-removes.test.mjs` |

## #230: live stdin with exact argv

| Requirement | Implementation | Verification |
| --- | --- | --- |
| `StreamingRunner::stdin_pipe()` keeps stdin open | `rust/src/stream.rs`, `stream_stdin.rs` | `rust/tests/stdin_pipe.rs` |
| `OutputStream::write_stdin` / `close_stdin` while chunks stream; kill grace and exit pump still apply | `rust/src/stream_stdin.rs` | `rust/tests/stdin_pipe.rs` |
| `ProcessRunner::from_argv(program, args, options)` that skips the shell and virtual commands, with `write_stdin`/`close_stdin` | `rust/src/process_argv.rs` | `rust/tests/process_argv.rs` |

## #231: terminal artifact selection

| Requirement | Implementation | Verification |
| --- | --- | --- |
| JS `artifacts: [...]` option, all by default, renderers skipped when not requested (no GIF render) | `js/src/terminal-artifacts.mjs`, `terminal-capture.mjs` | `js/tests/terminal-artifact-selection.test.mjs` |
| Rust `artifacts: Option<Vec<TerminalArtifact>>` | `rust/src/terminal/types.rs`, `artifacts.rs` | `rust/tests/terminal_options.rs` |
| Rust `recording.gif` | `rust/src/terminal/raster.rs` (`gif` + `font8x8`, no rasteriser) | unit tests in `raster.rs`, `terminal_options.rs` |
| Rust `aspect_ratio` (JS `aspectRatio`) | `TerminalCaptureOptions::aspect_ratio` | `terminal_options.rs` |
| Rust `on_trace` (JS `onTrace`) | `TerminalTraceCallback`, `TerminalTraceEvent` | `terminal_options.rs` |

## #232: fire-and-forget detached spawn

| Requirement | Implementation | Verification |
| --- | --- | --- |
| JS `$({ detached: true })` and `spawnDetached(command, options)`: new session, `stdio: 'ignore'`, `unref()`, resolve `{ pid }` on `spawn`, reject on `error` | `js/src/$.process-runner-detach.mjs`, `$.mjs` | `js/tests/detached-spawn.test.mjs` (pid = pgid = sid, outlives the caller, ENOENT rejection) |
| Rust `StreamingRunner::detach()` and `ProcessRunner::spawn_detached()`: null stdio, `process_group(0)` on Unix, `CREATE_NEW_PROCESS_GROUP \| DETACHED_PROCESS` on Windows, no `kill_on_drop`, returns `Option<u32>` | `rust/src/detach.rs` | `rust/tests/detach.rs` (own process group, survives drop, reaped) |
| Both honour `cwd` and `env` | shared spawn options | both test files |

## Libraries considered

- Node's `child_process.spawn` already provides `timeout`, `killSignal` and
  `detached`. `Bun.spawn` provides `timeout` and `detached`. The JS changes
  reuse these instead of adding dependencies.
- zx 8.8 (`$({ timeout })`) and execa 10 (`timeout`, `detached`,
  `env: { NAME: undefined }`) were probed in
  `experiments/issue-233/alt-libs-new-features.mjs`. Bun.spawn was probed in
  `bun-shell-new-features.mjs`. The feature catalog comparisons are based on
  these probes.
- `portable-pty` already has `CommandBuilder::env_remove` and `env_clear`.
  The standard library has `Command::env_remove` and `process_group`.
- For `recording.gif`, the `gif` crate encodes and `font8x8` provides glyphs.
  Rasterising the SVG recording would have needed `resvg` and a font loader.
- `rust-lang/crates-io-auth-action` is the official crates.io OIDC exchange.

## Documentation and examples

- `js/README.md`: the `timeout`, `loginShell`, `detached` and `spawnDetached`
  options. The signal details moved to `js/docs/SIGNALS.md` to keep the README
  under the 2,500-line limit.
- `rust/README.md`: live stdin, `from_argv`, environment removal, timeouts,
  detached commands and the new terminal capture options.
- Feature catalog: `timeouts`, `env-removal`, `detached`, and an extended
  `stdin-streaming`, with JS (Node and Bun) and Rust examples checked by
  `scripts/check-parity.mjs`.
