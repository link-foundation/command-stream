# Deno CDN storage outage

The failing run is JavaScript workflow `40133294698`, created at
2026-10-24T21:13:56Z for `0c4024377b7032778b6e9d859bb55a61b6d614e2`.
Its retry's Deno job is `120990927482`. The current default branch,
`5e58fc7012ac35c8e392bd5d4cc04a933a3abaaa`, is already an ancestor of this branch.

## Reproduction and root cause

The complete failed workflow and job logs are downloaded under
`ci-logs/issue-30/`. A lossless compressed copy of the failed job is in
`evidence/deno-120990927482.log.gz`.

- Job lines 619–622 show the checkout HTTP import, core execution, ShellJS
  execution, normal globs and finite depth-protection checks passing.
- Job line 624 reports HTTP 500 when esm.sh compiles the immutable GitHub source.
- An independent request at 2026-10-24T21:41:42Z returned HTTP 500 and
  `mkdir /esm/npm/.install-274404154: no space left on device`.
  The exact headers and response are in `evidence/`.
- Existing build-queue retries recognize HTTP 408 only. Retrying compilation
  cannot resolve an upstream filesystem that has been full across repeated runs.

Run the actual integration probe with the original immutable source:

```sh
COMMAND_STREAM_CDN_REPOSITORY=link-foundation/command-stream \
COMMAND_STREAM_CDN_REVISION=0c4024377b7032778b6e9d859bb55a61b6d614e2 \
GITHUB_EVENT_NAME=pull_request node js/scripts/test-deno-cdn.mjs
```

Repeat with `GITHUB_EVENT_NAME=push` to verify the strict default-branch policy.
This does not push anything; the variable selects the probe's error policy.
The real responses were checked under both policies, not just mocked.

## Repair and regression coverage

The checkout probe remains mandatory and runs first. The hosted probe is still
attempted with the existing bounded build-queue retries. Only an HTTP 500 import
failure at that exact esm.sh GitHub entry URL can trigger an independent HTTP
request. That request must also return HTTP 500 and the exact known storage
error before a pull request reports the hosted-only probe as skipped.

Compiler errors, runtime errors, dependency import failures, other HTTP statuses,
other response bodies, and failed diagnostic requests remain fatal. Unknown event
names, main pushes and manual runs remain fatal for the storage outage too.
The error tells a human exactly what to do: ask the esm.sh operator to free
storage under `/esm/npm`, then rerun the Deno CDN job. The branch requires no
extra secret or repository access to run its mandatory HTTP integration test.

`js/tests/deno-cdn-hosted.test.mjs` first ran against the original unconditional
probe behavior: 12 cases passed and four failed, including the PR outage case
and the three strict-event recovery-message cases. After the fix all 16 pass;
the CDN retry and ShellJS regression suites bring focused coverage to 29 passing
tests. Before/after logs and both actual event-policy runs are archived under
`evidence/`. Both actual probes execute the checkout assertions successfully;
the PR run exits zero with a specific warning, and the push run exits one with
recovery instructions.

Full local verification after the repair passes: 2,939 JavaScript tests with
10 skipped (67,056 assertions), and 983 Rust all-features tests with seven
ignored across 64 suites, including doctests. ESLint, Prettier, TypeScript,
duplication, Cargo formatting, and 473 workflow/layout/documentation tests pass.
All 37 executable feature examples agree in Node, Bun and Rust.
Lossless full-suite logs are archived under `evidence/`.

The existing issue #30 acceptance matrix and external-outcome limits in the
[previous audit](../oct24/analysis/requirements.md) still apply. This CI repair
does not establish independently published packages, external adoption,
production usage, or superiority in every competitor workload.
