# Plan (issue 216 / PR 217)

- [x] Download every run cited in the issue, plus the earlier failing JS runs on main and the last three scheduled link checks, into `ci-logs/` and `github/`.
- [x] Scan every log for errors, warnings, deprecations and suspicious passes (`analysis/warnings-scan.txt`).
- [x] Pin the three templates and compare all of their tracked files (`analysis/FILE-COMPARISON.md`). Audit what changed since issue 209 (`analysis/TEMPLATE-DELTA-AUDIT.md`).
- [x] Reproduce each failure before fixing it (F1, F2, F4, F5, F6, F9, F11, F12). Where a failure could not be reproduced (Rust signals), say so.
- [x] One atomic commit per finding, each with tests.
- [x] Self-review: replace the `--no-renames` fix that introduced a moved-fragment false pass (F11).
- [x] File upstream reports with a reproduction, a workaround and a fix: js-template#214, #215; rust-template#190; python-template#100.
- [x] Add default-off debug tracing (`CI_SCRIPTS_DEBUG`) to the new link re-check.
- [x] Run the local checks (`validation/local-checks.log`).
- [x] Write the analysis documents (`REPORT.md`, `VALIDATION.md`).
- [x] Commit the archive and experiments.
- [x] Review the PR's own CI runs. Fix the Windows CRLF tests (F13) and the `child_access` runtime wait (F14). Enable tracing for the one-off Deno failure (F15).
- [ ] Push and verify CI on the latest SHA.
- [ ] Merge main if it moved, review every comment channel, update the PR description, and mark the PR ready.

Maintainer actions outside this PR:

- Recreate the GitHub releases for npm 0.9.0–0.9.5 and 1.0.0–1.4.0 (F5), if wanted.
- Dismiss the three intentional CodeQL alerts listed in REPORT.md F9.
- Decide on the deferred template items: `bun-version: latest` → `1.x`, and longer `wait-for-crate` defaults.
