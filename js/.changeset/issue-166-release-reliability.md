---
'command-stream': patch
---

Fix false-positive releases and the "failed to deploy" restart in the JavaScript
release pipeline (issue #166):

- `publish-to-npm.mjs`: only report success when output-scan, exit code, and an
  `npm view` registry check all agree — a failed `changeset publish` (e.g. npm
  E404) can no longer create a GitHub release for a version that never reached
  npm.
- `check-release-needed.mjs`: always probe npm and emit `current_unpublished`,
  so a version that was committed to `main` but never published self-heals on the
  next push regardless of changeset state (closes the restart that "failed to do
  any deploy").
- New `wait-for-npm.mjs` step verifies, after publish, that the exact version is
  actually installable from npm — turning any "tagged but not on npm" divergence
  into a hard CI failure.
- `setup-npm.mjs` now asserts npm ≥ 11.5.1 (required for OIDC trusted
  publishing) and `create-github-release.mjs` caps the release-notes body and is
  idempotent on an already-existing release.
