---
'command-stream': patch
---

Prevent false-positive GitHub releases when the npm publish actually failed
(#166). `scripts/publish-to-npm.mjs` relied on command-stream's `$` throwing on
a non-zero exit, but `$` does not throw by default (errexit is off, see #156),
so a failed `changeset publish` (e.g. an npm E404) was still reported as
`published=true` and a GitHub release was created for a version that never
reached npm. The publish step now confirms success with three independent
checks — output-pattern scan, exit code, and an `npm view` registry
verification — and fails the job otherwise. `scripts/create-github-release.mjs`
and `scripts/version-and-commit.mjs` were hardened against the same
non-throwing-`$` false-positive class.
