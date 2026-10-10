# Issue 219 investigation

The prepared commit was `3ceffd6abe325d6ad74cc167849525799be353ba`, created
2026-10-10 at 23:19:28 UTC. The initial dependency-freshness run
`38094632045` started at 23:19:40 UTC against that same head SHA. Its archived
log reports six stale serde_json declarations at lines 639–645: both sections
of the library manifest, the benchmark manifest and three release scripts.
The required version changed from 1.0.151 to 1.0.152; both Cargo lockfiles
were refreshed. The subsequent local freshness check reports 90 current
direct dependencies.

## Reproduction and root cause

- `validation/deno-published-before.log.gz`: Deno 2.9.6 imports the published
  command-stream 2.0.0 package from esm.sh and fails with
  `ERR_INVALID_ARG_VALUE`, receiving the bare string `shelljs`.
- `validation/shelljs-cdn-before.log.gz`: two offline regression tests fail
  with the same createRequire validation, for a bare name and an HTTP URL.
- `validation/deno-http-before.log.gz`: the current source, served over HTTP
  with real esm.sh dependencies and a CDN CommonJS shim, reproduces the
  ShellJS loader error before any command can run.
- `validation/deno-eager-loader-before.log.gz`: after correcting ShellJS,
  independently restoring the main entry's eager loader reproduces a second
  error, this time receiving the HTTP module URL.
- `validation/deno-final.log.gz`: correcting both loaders permits importing
  `$`, running `echo hi`, sharing the ShellJS object, ordinary brace expansion
  and rejection of a finite 101-level recursive glob.
- `validation/focused-after.log.gz`: 21 Node/Bun compatibility and glob-safety
  tests pass. The local resolution regression uses separate dependency
  objects to verify that the guard still targets ShellJS's own dependency
  rather than assuming a hoisted installation.

The solution retains the synchronous ShellJS API and named export. It adds a
declared fast-glob dependency for the static CDN require branch while preserving
local resolution from ShellJS's installation path. The main entry creates its
filesystem-backed zx/Execa loader only when those APIs are accessed.

The CI smoke job tests the fresh merge over local HTTP and the immutable PR
head through esm.sh's GitHub registry. Automatic and manual JavaScript release
jobs both require this smoke job to succeed. Existing package versions remain
unchanged; JavaScript and Rust release fragments prepare patch releases.

The first real CDN probe exposed an error in the test's global dependency pins:
pinning the unused Execa 10 adapter also replaced ShellJS's Execa 5 dependency.
`validation/deno-real-cdn-wrong-pins.log.gz` records the resulting missing
`traversePathUp` export. The same failure appears at line 702 of the archived
CI job log `validation/deno-cdn-38095300057.log.gz`, run at 23:31:00 UTC against
`c96b95d`. The probe now pins only dependencies imported by the core entry.
`validation/deno-real-cdn-after.log.gz` verifies the actual esm.sh build of
`c96b95d`: import, command execution and glob protection all pass.

## Validation observations

The first full JavaScript run exposed the release-gate assertion's old list of
prerequisites; it was updated to include and enforce the new Deno gate. The
first Rust run observed incomplete stdout in the existing graceful-cancellation
test at `rust/tests/cancelled_output.rs:106`. Its focused rerun passed without
source changes; the complete suite was rerun to verify the dependency refresh.
The final local Bun run passed 2,621 tests with 10 skips; the Rust all-feature
suite and doctests passed 830 tests. Node integration passed 104 tests and
zx/Execa compatibility passed 528 tests with two skips.

Local Docker execution could not enter this host's cgroup. The pinned
Actionlint, ShellCheck and Zizmor binaries were extracted from the workflow
images and run directly. Hosted CI retains the production-install matrix.

`parity-exempt` applies because npm/CDN module loading has no Rust counterpart.
All 29 executable JavaScript/Rust feature comparisons still run and pass.
