# Issue #235 work plan and evidence

Objective: implement and verify the lightweight entry option from issue #235
in PR #236, preserving the existing full API.

- [x] Read the complete issue, required sub-issues (none), and all three PR
      feedback endpoints (no comments or reviews).
- [x] Inspect entry points, shared state, declarations, release and CI policies,
      and related merged PRs #194 and #234.
- [x] Reproduce the import graph and commit failing regression tests first.
- [x] Extract shared shell/virtual-command initialization into a public core
      entry, with ESM/CommonJS exports and accurate declarations.
- [x] Verify real commands, pipelines, quoting, shared state, and full API
      compatibility; enforce a deterministic module budget in CI.
- [x] Document the entry choice and measurement command; add a release changeset.
- [x] Diagnose existing CI failures using timestamp/SHA-matched downloaded logs,
      fix their causes, and verify the specific failures.
- [ ] Run local suites and quality checks sequentially within the memory limit.
- [ ] Review the complete PR diff, merge any default-branch updates, commit and
      push only to issue-235-32c1444df9bd.
- [ ] Update PR title/body with reproduction and verification evidence, await
      passing final-head CI, mark ready, and confirm a clean working tree.

## Initial CI investigation

Run 40076348439 belongs to the initial branch commit `8a5ee77`, created
2026-10-24T08:00:34Z. Its downloaded log is
`ci-logs/dependencies-40076348439.log` (ignored local evidence).
Lines 665–667 report Execa 10.1.1 vs 10.2.1 and fancy-regex 0.19.2 vs 0.20.0.
Execa 10.2.1 fixes the closed upstream TypeScript blocker. The declaration and
installed npm checks now pass after updating Execa, fancy-regex, and both Rust
lockfiles (including compatible cc/smallvec updates).

## Scope

The issue explicitly proposes a lightweight `command-stream/core` entry as an
alternative to changing the main API's loading behavior. The core entry will
share implementations and state with the full entry. Compatibility layers,
terminal capture, REPL/debugger and testing helpers remain available through
the full entry and dedicated compatibility subpaths. Installed dependency size
is unchanged; this addresses startup/module loading and bundling.

## Acceptance inventory

| Requirement                        | Implementation                                                           | Verification                                                           |
| ---------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Lightweight `$` entry              | `js/src/core.mjs`, package export `./core`                               | Fresh-process public entry probes; 70 ESM / 71 CommonJS modules        |
| ProcessRunner and virtual commands | Shared runner mixins and built-in initialization; `command-registry.mjs` | Tagged, synchronous, exact-argv and virtual pipeline execution         |
| Avoid unused feature loading       | Core excludes compatibility, terminal, installer and development modules | Loader-hook forbidden-module checks and an executed esbuild bundle     |
| Prevent startup regression         | Fewer than 100 non-builtin modules in either format                      | `core-entry.test.mjs` in Bun and Node 22/24/26 CI                      |
| Preserve existing features         | Full entry re-exports core and attaches the same optional APIs           | Shared-state/identity checks, declaration coverage and existing suites |
| Supported public API               | ESM/CommonJS declarations and `docs/CORE.md`                             | Strict TypeScript consumers and package dry-run file inventory         |
| Prepare release                    | One minor JavaScript changeset; Rust dependency patch fragment           | PR changeset validator and release CI                                  |

## Reproduction and review notes

The pre-fix main import loaded 284 modules in approximately 461 ms under local
Node 26.12.1. Commit `7bb8fe2` preserves four failing core regressions before the
implementation. The core budget uses module count rather than elapsed time to
avoid hardware-dependent failures.

The first full Bun run passed 2,795 tests and skipped 10; its sole failure was
an expanded README exceeding the 2,500-line documentation limit. Moving the
guide to `js/docs/CORE.md` fixed it; the focused core/declaration/documentation
rerun passed all 257 tests. The final dependency-updated Bun run passed 2,800 tests, skipped 10, and had
zero failures across 178 files. Strict declarations, direct and installed
dependency freshness, formatting, lint and duplication checks also pass.
Node and Rust validation are recorded separately in the PR.

Local raw logs stay in the ignored `ci-logs/` directory. Final suite totals and
final-head CI run links are maintained in the
[PR description](https://github.com/link-foundation/command-stream/pull/236).
The remaining workflow checklist above records the status at implementation;
the PR is the live verification record.
