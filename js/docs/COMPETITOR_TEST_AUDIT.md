# Competitor test corpus audit

This document defines the upstream process-execution test corpus used by
command-stream. The executable ports live in
[`tests/competitor-compatibility.test.mjs`](../tests/competitor-compatibility.test.mjs),
and their machine-readable provenance is in
[`tests/competitor-corpus.mjs`](../tests/competitor-corpus.mjs).
Every pinned upstream test unit and its sole disposition is recorded in
[`tests/competitor-dispositions.jsonl`](../tests/competitor-dispositions.jsonl).
The generator reads the separately reviewable, exact unit-ID decisions in
[`tests/competitor-decisions.jsonl`](../tests/competitor-decisions.jsonl); it
fails when an upstream unit is unclassified or a decision is stale.
The exact discovery queries, returned repositories, additional ecosystem
nominations, popularity snapshot, and rejection reasons are checked in at
[`../../docs/COMPETITOR_DISCOVERY.json`](../../docs/COMPETITOR_DISCOVERY.json).

## Selection rule

The corpus includes open-source JavaScript or TypeScript projects whose main
product, or a distinct part of it, executes arbitrary commands. A project is
included when it had at least 500 GitHub stars on 2026-09-13, or when it is the
native process primitive of a supported JavaScript runtime. `@david/shell` is
included as a separately pinned source because it is the command engine to
which the selected Dax project delegates; its own star count is not used as an
independent threshold exception.
Archived projects remain eligible when their published package still defines a
widely used competing contract, as is the case for cross-env.

Task orchestrators, terminal emulators, interactive CLI shells, and bridges
limited to one guest language are outside this definition. For example,
`python-shell` is a Python bridge rather than a general process API. This rule
makes “top open-source projects” reproducible instead of an open-ended list.

## Pinned upstream inventory

Stars are discovery metadata captured on the snapshot date, not a ranking
promise. Commits, source counts, and test registration counts are immutable
audit inputs. Registration counts are static `test`/`it`/`Deno.test` sites;
parameterized tests may execute more cases. Node's internal harness does not
have a comparable registration primitive, so its 117 scoped files are the
inventory unit.

| Project                                 | Pinned commit                              | Scoped source                                                         | Files | Registrations |
| --------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- | ----: | ------------: |
| Node.js `child_process`                 | `6193e15483395080c6438399211aa7fab70f4e5e` | `test/{parallel,sequential,pummel}/test-child-process-*.js`           |   117 |           n/a |
| Bun Shell and `child_process`           | `09bb5463058074ef143a9d9a5a405d669c787375` | `test/js/{bun/shell,node/child_process}/**/*.test.*`                  |    53 |           414 |
| `Deno.Command` and `node:child_process` | `336da420f4343cbb1dcbd5eed9d075ff555ed6ee` | `tests/unit/command_test.ts`, `tests/unit_node/child_process_test.ts` |     2 |           137 |
| Execa                                   | `8017b279e19347efaf2587711c2d57dbd4330740` | non-fixture `test/**/*.js`                                            |   151 |         5,133 |
| zx                                      | `65fc542d88baac578967e22bea28cb610976578c` | `test/**/*.test.{js,cjs,mjs,ts}`                                      |    23 |           287 |
| ShellJS                                 | `f364da6625945414440bb15210f102ba5fc10ed9` | non-resource `test/**/*.js`                                           |    40 |           630 |
| cross-spawn                             | `77cd97f3ca7b62c904a63a698fc4a79bf41977d0` | `test/index.test.js`                                                  |     1 |            25 |
| cross-env                               | `9951937a7d3d4a1ea7bd2ce3133bcfb687125813` | `src/__tests__/*.test.ts`                                             |     5 |            63 |
| Dax                                     | `d5e8c18ee28a8317b098c860ee98786a828c0e04` | `mod.test.ts`                                                         |     1 |            12 |
| `@david/shell`                          | `eba92f9c9fcc58e02a8385097791056fd0d2b7ad` | `mod.test.ts`, `src/**/*.test.ts`                                     |    14 |           387 |
| nano-spawn                              | `cc231e2c7b1e434a96f25f907ca2cb2f7c596e90` | non-fixture `test/**/*.js`                                            |     8 |           262 |
| `@actions/exec`                         | `193fa46c20fde8b0ed54194bc08b841c78c0776d` | `packages/exec/__tests__/exec.test.ts`                                |     1 |            32 |

The complete snapshot covers 416 source files (including the 117 Node.js
harness files) and 7,382 statically discoverable registrations. Lifecycle
hooks are not registrations; chained test modifiers such as `test.skipIf` are.

## What 100% accounting means

The upstream projects expose different APIs, runtimes, fixtures, and test
frameworks. Copying their files byte-for-byte would mostly test that Execa,
Bun, or zx exists. Instead, every scoped test belongs to exactly one disposition:

1. A portable public process invariant is adapted into the executable suite.
2. A public invariant needs a feature command-stream does not have and is listed
   in the missing-feature ledger below.
3. A test is inapplicable because it verifies competitor API shape, private
   internals, unrelated utilities, runtime behavior, or harness mechanics.

The API-shape exclusion applies only to names, types, and call surfaces. If a
test observes child output, status, errors, environment, working directory, or
lifecycle, that process behavior is ported or recorded as missing even when the
competitor exposes it through a custom result object.

The port uses a tiny cross-platform child fixture and command-stream's public
API. Assertions are executable and fail on behavioral regressions; there are no
conceptual always-passing assertions. Similar parameterized upstream cases are
collapsed into one local table-driven invariant, while edge-case values are
preserved. No missing feature was introduced merely to make an upstream test
pass.

The integrity tests load the generated 7,515-unit disposition manifest and the
7,515 exact reviewed decisions. They enforce identical unit-ID sets and
dispositions, unique stable IDs, exact source and registration totals,
source-specific pinned URLs, complete selected-project coverage, execution of
every port registry entry, full commit SHAs, and a heading for every missing
feature. This turns “100% accounting” into a checked property rather than a
summary-level assertion.

## Executable behavior ports

| Case ID                       | Public invariant                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `direct-exact-argv`           | Direct execution bypasses shell tokenization.                                                    |
| `argument-edge-cases`         | Empty, whitespace, multiline, Unicode, quote, and shell-metacharacter arguments survive exactly. |
| `safe-template-interpolation` | An untrusted interpolated value remains one literal argument.                                    |
| `array-interpolation`         | An interpolated array expands to separate, safely quoted arguments.                              |
| `cwd-string`                  | An explicit string working directory reaches the child.                                          |
| `environment`                 | An explicit environment reaches the child without value corruption.                              |
| `stdout-stderr-separation`    | Standard output and error remain separate.                                                       |
| `newline-preservation`        | Captured output preserves final and repeated newlines.                                           |
| `unicode-output`              | UTF-8 output is decoded without loss.                                                            |
| `large-output`                | One MiB of output is captured without truncation or deadlock.                                    |
| `nonzero-exit`                | Non-zero status is returned through `code` and `exitCode`.                                       |
| `result-text`                 | `text()` returns captured stdout.                                                                |
| `stdin-string`                | String input is written completely and stdin is closed.                                          |
| `stdin-buffer`                | Buffer input is written without textual coercion.                                                |
| `lazy-execution`              | A runner starts only when consumed.                                                              |
| `concurrent-execution`        | Concurrent children keep their results isolated.                                                 |
| `streamed-before-exit`        | Output events arrive before a delayed child exits.                                               |
| `events-and-await`            | Events and the awaited result observe identical bytes.                                           |
| `bound-options`               | Options bound to a tagged command apply when the command executes.                               |
| `sync-execution`              | Synchronous direct execution preserves exact argv.                                               |
| `programmatic-pipeline`       | Source stdout becomes destination stdin.                                                         |
| `spawn-error-result`          | Sync and async unavailable executables produce results instead of uncaught errors.               |
| `abort-signal`                | An external `AbortSignal` terminates a running child.                                            |

The source-path samples attached to each case in the manifest identify where
the invariant appears upstream. Existing focused command-stream suites continue
to exercise shell operators, virtual commands, built-ins, terminal capture,
signals, cleanup, CommonJS, and runtime-specific paths in greater depth.

## Missing-feature ledger

These are comparison inputs for later work, not promises that every competitor
choice fits command-stream. Stability of the existing API takes priority. A
future implementation should add a failing focused test and update the manifest
in the same change.

### timeout-option

Execa, zx, Dax, and nano-spawn provide a per-command deadline option.
command-stream accepts external abort signals but has no public timeout option.

### ipc-and-fork

Node, Bun, Deno's Node compatibility layer, and Execa expose IPC channels or
fork helpers. command-stream currently exposes only stdin/stdout/stderr process
communication.

### custom-stdio-descriptors

Node-derived APIs accept arbitrary stdio arrays, extra file descriptors, files,
and inherited streams. command-stream has fixed stdin/stdout/stderr policies.

### configurable-encoding

Several competitors support caller-selected encodings or raw binary output.
command-stream results currently expose strings, with Buffer access available
through streaming interfaces rather than a result encoding option.

### max-buffer-policy

Node `exec`, Execa, and ShellJS allow a maximum captured-output policy.
command-stream streams and captures without a configurable upper bound.

### output-transforms-and-line-iteration

Execa, zx, Dax, and nano-spawn provide line iteration, transforms, generators,
or verbose output hooks beyond command-stream's typed chunk stream.

### local-binary-resolution

Execa and zx can resolve project-local binaries and prefer local executables.
command-stream currently follows the supplied executable and environment path.

### windows-shebang-and-pathext-resolution

cross-spawn and nano-spawn normalize Windows shebangs, `PATHEXT`, and `cmd.exe`
escaping. command-stream relies on the runtime and platform shell for those
rules and does not provide a dedicated resolver.

### cross-platform-inline-environment-syntax

cross-env rewrites portable inline environment assignments and Unix-style
variable references for Windows command processors. command-stream accepts an
explicit environment object, but it does not provide this command-line rewrite
layer.

### environment-clear-and-remove

Deno can clear inherited environment values before spawning. command-stream
can add or replace values but has no environment clear/remove policy.

### process-credentials

Node and Deno can select child user and group IDs on supported platforms.
command-stream has no public process-credential options.

### windows-process-window-options

Node and Deno expose Windows-only process creation controls such as hidden
windows and raw command-line arguments. command-stream delegates those choices
to the JavaScript runtime.

### child-process-handle-lifecycle

Node and Deno expose raw child handles with `ref`, `unref`, explicit disposal,
and PID lifecycle rules. command-stream exposes a higher-level runner and
stream rather than the same shared handle contract.

### url-executable

Deno accepts a file URL as the executable. command-stream's exact-argv API
accepts an executable path string.

### shell-builtin-breadth

Bun Shell, ShellJS, and Dax implement more built-ins and shell grammar than
command-stream's current virtual-command set.

### rich-error-and-timing-metadata

Competitors expose fields such as command text, escaped command, failed stage,
signal description, duration, and timing. command-stream's result is limited to
status and captured streams.

### graceful-termination

Execa, zx, and Dax provide configurable graceful cancellation and forced-kill
fallbacks. command-stream supports a kill signal but no public grace-period
policy.

### combined-all-output

Execa and nano-spawn can preserve interleaved stdout and stderr in a combined
result. command-stream deliberately keeps the two captured streams separate.

### iterable-and-stream-input-options

Execa, Dax, and nano-spawn accept iterable, web-stream, or richer Node stream
inputs as options. command-stream options accept string, Buffer, inherit,
ignore, or an interactively accessed stdin pipe.

### layered-bound-option-merging

Execa can bind several option layers and merge selected nested fields while
letting invocation-level values override defaults. command-stream supports one
bound tagged-template option object but not layered or per-invocation merging.

### url-working-directory

Execa and Dax accept a file URL as `cwd`. command-stream currently guarantees a
filesystem path string; unsupported or inaccessible values fall back to a safe
directory.

## Inapplicable upstream test classes

- **Competitor API shape:** pure constructor, export, TypeScript, and return-type
  surface checks that do not assert an observable child-process result.
- **Competitor internals:** private parsers, mocks, logging internals, error
  subclasses, and implementation-specific call order.
- **Runtime-only behavior:** Bun and Deno conformance unrelated to starting or
  communicating with a command.
- **Unrelated utilities:** zx helpers, most ShellJS filesystem utilities,
  GitHub Actions tool-cache behavior, and Dax HTTP or console helpers.
- **Harness mechanics:** upstream fixture self-tests, snapshots, permissions,
  CI probes, and test-runner integration.

## Refresh procedure

1. Repeat the nine exact GitHub queries stored in
   `docs/COMPETITOR_DISCOVERY.json`, inspect every returned and nominated
   candidate, and record additions, rejections, or removals explicitly.
2. Pin each repository to a full commit before inspecting tests.
3. Recount scoped files and static registrations at that commit.
4. Run
   `node js/scripts/generate-competitor-dispositions.mjs --js-root PATH --rust-root PATH --rust-extra-root PATH`
   with directories containing checkouts named as specified by the generator,
   then review every changed disposition.
5. Adapt new portable public invariants into the fixture-based suite.
6. Add unsupported behavior to the ledger; do not silently implement features.
7. Run `bun run test:competitors`, the full JavaScript tests, lint, formatting,
   and duplication checks.

The local tests contain original fixture code and API-neutral assertions; they
do not vendor competitor implementation code or fixture data.
