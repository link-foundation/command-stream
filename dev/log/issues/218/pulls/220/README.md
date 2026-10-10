# Issue #218 / PR #220 validation evidence

The Node 22 slim reproduction packed the pre-fix 2.0.0 manifest and attempted a
production install without Python, make, gcc, or g++. node-pty found no Linux
prebuild and node-gyp failed; npm returned exit 1. Both new regression tests
failed before the dependency and PTY host changes.

`validation/install-before.log.gz` and `validation/regression-before.log.gz`
preserve these observations. `validation/install-node22.log.gz`,
`validation/install-node24.log.gz`, and `validation/install-node26.log.gz`
record the successful local/global production installation matrix after the
fix: scripts enabled (explicitly allowlisted on npm 12), scripts disabled, and
optional dependencies omitted. Each smoke check uses bare ESM/CommonJS exports,
the standalone ProcessRunner path, literal argv with spaces, and the public
openTerminal recovery error.

The local Docker daemon needed `--cgroupns=host --cgroup-parent=/` because its
default cgroup was not usable. CI uses the standard Docker configuration.
The tests assert that no build toolchain exists inside the containers.

The initial dependency freshness run was created at 2026-10-10 08:41:21 UTC for
SHA `c2c8c97c1e60807ded4c07317c3926aa4dc09ecb`:
https://github.com/link-foundation/command-stream/actions/runs/38038748584

Lines 637–642 of `ci-logs/dependency-freshness-38038748584.log.gz` report stale
@types/node (26.6.4 → 26.6.5), jscpd (5.4.0 → 5.4.1), prettier (3.9.9 → 3.9.10),
and the Rust version-check script's toml (1.1.6 → 1.1.8). Compatible updates
were also pending in both Cargo lockfiles (cc, smallvec, syn). The PR refreshes
these declarations/lockfiles; the local check now reports all 89 direct
dependencies current.

The first full Bun run exposed local missing prerequisites (jq and a compiled
node-pty binding), which were installed/built before validating PTY behavior.
A later run exposed an existing signal test's startup race at
`js/tests/ctrl-c-signal.test.mjs:830`: the child exit status was null because a
fixed-delay SIGINT could arrive before startup completed. The test now waits
for the runtime marker using the adjacent tests' readiness helper, and all
13 signal tests pass. Install instructions were moved into a linked guide to
respect the README's 2500-line limit.

The first implementation CI run at SHA `ee58b0a` exposed the remaining ordering
race on macOS: the runtime marker still preceded runner construction, which
installs SIGINT handling. Lines 1518–1529 of
`ci-logs/javascript-macos-114178127795.log.gz` show the null exit status.
`experiments/issue-218/signal-readiness.mjs` deterministically reproduces that
ordering (null code / SIGINT) and verifies the corrected ordering (130 / no
signal). The test now constructs the runner before printing its marker.

The next CI run at SHA `f0f687e` passed the signal test but exposed a separate
timing assumption in the zx concurrent-producer fixture. Lines 6740–6758 of
`ci-logs/javascript-macos-114179848362.log.gz` show `a,c,b,d,e` instead of
`a,b,c,d,e`. The fixture had already widened sleep gaps to reduce races;
`experiments/issue-218/pipeline-order.mjs` reproduces the reordered output
with a deliberately delayed producer. The fixture now uses consumer
acknowledgments to release producers, retains its exact output assertion and
adds bounded process timeouts and cleanup. It passes 20 Bun repetitions.

Final local verification: the full Bun suite passes (2613 passed, 10 skipped,
zero failures across 158 files); Node integration has 104 passing tests and
zx/Execa compatibility has 528 passing tests with two skips. Rust all-feature
and doctest suites have 830 passing tests, and benchmark tests have 10 passes.
ESLint, repository formatting, duplication, TypeScript declarations, Clippy,
Actionlint, ShellCheck, Zizmor, all 29 executable parity features, generated
documentation, version guards and dependency freshness pass.
