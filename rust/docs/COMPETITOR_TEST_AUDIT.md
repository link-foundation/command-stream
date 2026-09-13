# Rust competitor test corpus audit

This document defines the upstream process-execution test corpus used by the
Rust implementation of command-stream. Executable behavior ports live in
[`tests/competitor_compatibility/behavior.rs`](../tests/competitor_compatibility/behavior.rs),
and machine-readable provenance lives in
[`tests/competitor_compatibility/corpus.rs`](../tests/competitor_compatibility/corpus.rs).
Every pinned upstream test unit and its sole disposition is recorded in
[`tests/competitor_dispositions.jsonl`](../tests/competitor_dispositions.jsonl).
The shared exact discovery inputs, captured results, nominations, and rejection
ledger are in
[`../../docs/COMPETITOR_DISCOVERY.json`](../../docs/COMPETITOR_DISCOVERY.json).
The JavaScript implementation has an independent
[JavaScript ecosystem audit](../../js/docs/COMPETITOR_TEST_AUDIT.md).

## Selection rule

The corpus includes open-source Rust library crates whose main public product
executes arbitrary child processes. A project is included when it had at least
100 GitHub stars on 2026-09-13; an archived repository remains relevant when
its released library still defines a competing contract. Native process
primitives from Rust's standard library and general-purpose async runtimes are
also included because higher-level crates build on those contracts.

Process-group wrappers without a general execution API, shell tokenizers,
terminal emulators, standalone command-line tools, task orchestrators, and
crates that only generate command lines are outside this definition. The lower
star threshold than the JavaScript corpus reflects the smaller Rust
process-library ecosystem while keeping “top open-source projects”
reproducible instead of open-ended.

## Pinned upstream inventory

Stars are discovery metadata captured on the snapshot date, not a ranking
promise. Commits, source counts, and test registration counts are immutable
audit inputs. Registrations are static `#[test]`, `#[tokio::test]`, and similar
test attributes; parameterized helpers can execute more cases. Rust compiler
UI tests are counted by scoped source file because each file is a harness unit.

| Project             | Pinned commit                              | Scoped source                                            | Files | Registrations |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- | ----: | ------------: |
| Rust `std::process` | `24d472027454741e74f8e913755fbc7e03f02af5` | `library/std/src/process/tests.rs`, `tests/ui/process/*` |    39 |            30 |
| Tokio process       | `6276684c288d8e513410219fa2129c69df41af18` | `tokio/tests/process_*.rs`                               |     9 |            10 |
| async-process       | `f4485f156f9294b86a5be37f7236bcf0cf93c76b` | `tests/*.rs`                                             |     2 |            24 |
| assert_cmd          | `a57ef45a33986390be3057c192c6bdbe61b8912d` | non-fixture `tests/**/*.rs`                              |     4 |            18 |
| duct                | `0195544c9d963d94348e8bc94fc60b8519e5516b` | `src/test.rs`                                            |     1 |            39 |
| xshell              | `52f71bac326aaac291d07146ea790ad886dd8131` | non-data `tests/**/*.rs`                                 |     6 |            60 |
| subprocess          | `e8cd8d0c930a790ce29373a8c3ee080dd746b9eb` | `src/tests/**/*.rs`, `tests/*.rs`                        |     9 |           206 |
| rust_cmd_lib        | `5a87af574a694fbfd0d4ade0c9b3dadc7cd463f6` | `tests/*.rs`                                             |     1 |            27 |
| run_script          | `a79fdf0e15afca84681e5cf104bc080ceec60954` | `src/*_test.rs`, `tests/*.rs`                            |     7 |            45 |
| bkt                 | `76c4d24306bd9679ebc6cbacfdb9934ec9ba3be5` | `src/lib.rs`, `tests/*.rs`                               |     3 |            48 |
| rust-shell          | `8b1e775b09c133c9bfbfbb9be2e3a2b2f4219682` | test modules in `src/*.rs`, `tests/shell_tests.rs`       |     4 |            11 |
| shellfn             | `d8e2f39ab6633b388b0f9b47ea62c95dc7ee78ca` | `tests/tests.rs`                                         |     1 |            72 |
| rexpect             | `4c6a13d3d2c79cd63c8b12821530ec015b34fc71` | test modules in `src/{process,reader,session}.rs`        |     3 |            23 |
| expectrl            | `a2407de94df0b05dd794f79c57dea7b6f0a86f1f` | `tests/*.rs`, process and async-session test modules     |    10 |           118 |

The snapshot covers 99 source files and 731 statically discoverable test
registrations. The 38 Rust compiler UI files are additional file-level harness
units, while test attributes embedded in UI fixture source are not counted as
harness registrations.

## What 100% accounting means

The projects expose different APIs, executors, fixtures, macros, and runtime
assumptions. Copying their files byte-for-byte would mostly test those crates.
Instead, every scoped test belongs to one disposition:

1. A portable public process invariant is adapted into the executable suite.
2. A public invariant needs a feature command-stream does not have and is in
   the missing-feature ledger below.
3. A test verifies competitor API shape, private internals, unrelated helpers,
   upstream runtime behavior, or harness mechanics and is inapplicable.

Similar upstream cases are collapsed into one local table or invariant while
retaining representative edge values. The local suite compiles a tiny
standard-library child fixture, then invokes it only through public
command-stream APIs. Shell-independent cases execute on Linux, macOS, and
Windows; the POSIX shell interpolation invariant is gated to POSIX targets.
No missing feature was introduced merely to satisfy an upstream test.

The corpus integrity tests load the generated 770-unit disposition manifest,
pin all commits, enforce unique upstream IDs and one valid disposition per
unit, validate every source-specific URL and exact inventory total, and ensure
all fourteen selected projects are represented.

## Executable behavior ports

| Case ID                       | Public invariant                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `direct-exact-argv`           | Direct execution bypasses shell tokenization and preserves argument boundaries.            |
| `argument-edge-cases`         | Empty, whitespace, multiline, Unicode, quote, and metacharacter arguments survive exactly. |
| `safe-template-interpolation` | On POSIX shells, an untrusted interpolation remains one literal argument.                  |
| `cwd-string`                  | An explicit working directory reaches the child.                                           |
| `environment`                 | Explicit environment values reach the child without corruption.                            |
| `stdout-stderr-separation`    | Standard output and error remain separate.                                                 |
| `newline-preservation`        | Captured output preserves final and repeated newlines.                                     |
| `unicode-output`              | UTF-8 output is captured without loss.                                                     |
| `large-output`                | One MiB is captured without truncation or deadlock.                                        |
| `nonzero-exit`                | A non-zero child status is returned without discarding output.                             |
| `stdin-string`                | String input is written completely and stdin closes.                                       |
| `lazy-execution`              | Constructing a runner does not spawn it.                                                   |
| `concurrent-execution`        | Concurrent children keep results isolated.                                                 |
| `streamed-before-exit`        | Output arrives before a delayed child exits.                                               |
| `sync-execution`              | Synchronous execution returns captured output and status.                                  |
| `programmatic-pipeline`       | One process's stdout becomes the next process's stdin.                                     |
| `spawn-error-propagation`     | An unavailable exact executable returns an error, never a false success.                   |
| `stream-kill`                 | Killing an active stream terminates the child and reports termination.                     |

Existing focused Rust tests continue to cover shell parsing, virtual commands,
signals, process groups, terminal capture, redirection, state, and built-ins in
greater depth.

## Missing-feature ledger

These are comparison inputs for later work, not promises that every competitor
choice fits command-stream. A future implementation should start with a failing
focused test and update the corpus in the same change.

### array-and-splat-interpolation

xshell and rust_cmd_lib expand collections into separate arguments in their
command macros. command-stream's Rust macros currently interpolate scalar
display values only.

### non-utf8-arguments-and-environment

The native, Tokio, async-process, assert_cmd, and subprocess APIs accept
platform `OsStr` values throughout. `StreamingRunner::from_argv` accepts native
arguments, but command-stream's environment and captured result APIs require
UTF-8 strings, so it cannot preserve this contract end to end.

### binary-input-and-lossless-output

Several competitors accept byte input and return raw output bytes.
command-stream streaming chunks are bytes, but collected output and configured
stdin are strings and use lossy UTF-8 decoding.

### environment-clear-and-remove

Native process builders and several wrappers can clear the inherited
environment or remove one variable. command-stream can add or replace values
but has no clear/remove policy.

### custom-stdio-and-file-handles

The lower-level competitors accept null, inherited, piped, file-backed, and
caller-supplied standard I/O handles. command-stream exposes fixed policies and
does not accept arbitrary handles.

### timeout-option

assert_cmd, xshell, run_script, rexpect, and expectrl expose deadlines in their
assertion, script, or session layers. command-stream can be cancelled through
its stream handle but has no per-command timeout option.

### try-wait-and-shared-child-handle

Native process builders, Tokio, async-process, and subprocess expose a child
handle with non-blocking status inspection. command-stream intentionally
returns a runner or output stream rather than a shareable child handle.

### native-exit-status-and-signal-metadata

Lower-level process APIs retain the platform `ExitStatus` and signal metadata.
command-stream normalizes termination to an integer code.

### expect-and-pty-session

rexpect and expectrl provide pattern-based reads and writes against an
interactive PTY. command-stream can capture scripted terminal sessions but
does not expose an open-ended expect session API.

### shell-expression-composition-and-redirection

duct, xshell, rust_cmd_lib, and rust-shell compose expressions, redirections,
or checked pipelines through their own typed or macro APIs. command-stream
supports shell strings and a pipeline builder but not those competitor-specific
composition models.

### subprocess-result-caching

bkt persists subprocess output and status, keys entries from command state,
and supports expiry, stale refresh, and cache invalidation. command-stream
executes every invocation and has no result-cache policy.

### typed-script-return-adapters

shellfn turns scripts into typed Rust functions, maps arguments through the
environment, and parses output into declared return types. command-stream
returns a process result and leaves domain-specific parsing to the caller.

## Inapplicable upstream test classes

- **Competitor API shape:** constructors, traits, macros, types, snapshots, and
  competitor-specific result objects.
- **Competitor internals:** private executors, parsers, async reactors, mocks,
  and implementation-only errors.
- **Upstream runtime regressions:** compiler, standard-library, Tokio, and
  dependency behavior that does not exercise command-stream.
- **Unrelated utilities:** filesystem helpers, assertion formatting, script
  discovery, and general utilities outside process execution.
- **Harness mechanics:** compile-fail annotations, fixture self-tests,
  permissions, snapshots, CI probes, and test-runner integration.

## Refresh procedure

1. Repeat the exact Rust GitHub queries and ecosystem nominations stored in
   `docs/COMPETITOR_DISCOVERY.json`, then record every candidate disposition.
2. Pin every repository to a full commit before inspecting its tests.
3. Recount scoped files and static registrations at that commit.
4. Run
   `node js/scripts/generate-competitor-dispositions.mjs --js-root PATH --rust-root PATH --rust-extra-root PATH`
   with directories containing checkouts named as specified by the generator,
   then review every changed disposition.
5. Adapt new portable public invariants into the fixture-based suite.
6. Add unsupported behavior to the ledger; do not silently implement features.
7. Run `cargo test --test competitor_compatibility` and the full Rust CI suite.

The local tests contain original fixture code and API-neutral assertions; they
do not vendor competitor implementation code or fixture data.
