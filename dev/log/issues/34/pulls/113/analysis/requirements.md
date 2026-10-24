# Issue 34 / PR 113 acceptance evidence

Sources reviewed: the complete [issue](https://github.com/link-foundation/command-stream/issues/34), its empty comment collection, the PR description, all conversation comments, inline comments and reviews, and merged PRs 225 and 236. There are no required sub-issues. The implementation is reconciled with main commit `2f8cea139a1b00f3067b11785616f3f2ea00ecc4`.

| Requirement | Implementation and verification |
| --- | --- |
| Exact `$.command('cat', path).pipe($.command.stdout('inherit'), $.command.exitCode).run()` example | `js/src/command-builder.mjs`; test `the exact issue example inherits stdout and returns an exit code` in `js/tests/command-builder.test.mjs` executes a real temporary file. |
| Avoid quoting and shell injection; produce a runnable string | Native exec specification, no shell reparsing; quote executable and each argument for POSIX rendering. Tests round-trip empty strings, spaces, quotes, newlines, operators and command substitutions, plus executable paths containing special characters. Windows runs argv directly; rendered text is explicitly POSIX. |
| Immediate execution and reusable descriptions | Await/run, synchronous execution, and runner/stream access; immutable copies retain argument/configuration state. Tests execute descriptions repeatedly and verify result/exit-code selection. |
| Support API styles and configurations from the PR feedback | Variadic and argv-array factories, constructor, fluent methods, functional transforms, option objects, nested factory defaults, configured tags and `create`; all ProcessOptions pass through the existing runner. Tests cover environment precedence/removal, cwd, buffered/live stdin, stdio, capture/mirror, overrides, deadlines, abort, events, pipelines and streams. Node tests cover full/core ESM/CommonJS; strict TypeScript tests cover the public exports and signatures. |
| Rust counterpart and the referenced Rust Command patterns | Owned fluent/functional composition, env/envs/clear/removal, stdio, cwd, async and sync execution using one native command configuration. A 160 KiB stdin/stdout test verifies concurrent draining instead of blocking on a full pipe. |
| Resolve conflicts without removing current features | Merge main into the prepared branch, retain the monorepo layout and current core/compatibility implementations; only the obsolete draft builder tests/examples are replaced. Compare the final diff against main and run the existing suites. |
| Clear docs and comparison across all features | `js/docs/COMMAND-BUILDER.md` documents every builder operation and runner option, precedence, execution contracts and safety boundaries. `js/docs/COMPARISON.md` covers process, shell, streams, lifecycle, compatibility, terminal, translation and development features with primary-source links, covering all twelve projects in the pinned JavaScript audit, both issue references, and the fourteen-project Rust audit. Generated feature examples provide further per-feature alternatives. |
| Competitive claims supported by evidence | Credit competitors' argv safety, fluent options, streams, transforms, plugins and native process controls. Link import-budget checks, compatibility corpora, feature examples and benchmarks. No unmeasured claim that one library universally outperforms every competitor; the comparison records specialized contracts and runtime limits explicitly. |
| Prepare release and review | JavaScript minor changeset and Rust minor changelog fragment; update PR title/body, preserve `Fixes #34`, verify current-SHA checks and mark ready without merging. |

## Reproduced failures and root causes

Before implementation, the focused JavaScript suite failed on missing fluent methods, array/options construction, preset factories and per-run configuration. The main builder exposed only a subset of those entry styles and ignored run arguments. Preset env objects also remained caller-owned until command construction; a separate failing regression demonstrated that mutation leak before snapshots were added.

Review found another env-preset failure: `command.with({env: {A: 'a'}})('echo', [])` dereferenced an absent options argument. The array/preset regression was run failing before `mergeOptions` received its default override object.

The Rust reproduction initially failed to compile with E0599 at `.pipe` and `.env_clear`. Adding synchronous execution and sharing native command configuration across sync/async resolves those missing contracts while retaining literal OsString arguments and signal exit status normalization.

All regression cases remain in the normal automated suites. Investigation logs are kept under `.git/issue-34/` locally; fresh remote failures, if any, are downloaded under `ci-logs/` and checked against commit timestamps and SHA.
