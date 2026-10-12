# CI investigation

The latest original branch commit is ac8110decd169e025ee7934442c3c7026d355040,
committed September 9, 2025 at 18:42:44 UTC. The only historical branch run is
17592472281 (CI), created at 18:42:55 UTC with that exact SHA. Its Bun test job
failed; the Node compatibility jobs passed. Thus this failure belongs to the
latest original commit, despite the later issue and PR edits.

`gh run view 17592472281 --log` returned HTTP 410: the historical logs expired.
The retained check annotations and job step metadata were downloaded instead;
see old-ci-annotations.json and old-ci-jobs.json. The relevant annotation points
to tests/virtual-ecosystem.test.mjs:315: expected "Commands must be a non-empty
array", received "null is not an object (evaluating 'commands.length')". The old
composeCommands trace dereferences commands.length before parameter validation
when verbose tracing is enabled.
Main's replacement compose validates handlers first. The new ecosystem test
covers empty composition, null/undefined handlers, and invalid later stages,
with tracing both enabled and disabled.

All local command logs are saved under ci-logs. The first full Bun run encountered
28 jq failures because jq was absent, plus an authenticated GitHub API timeout:
full-bun.log:908 reports `jq: not found`; lines 1519–1521 report the ten-second
complex GitHub gist pipe timeout. These are outside the changed ecosystem code.
The container was supplied with jq, and the full suite was rerun with CI=true,
matching CI's existing exclusion of live-account gist writes. No timeout increase
or test weakening was used.

The documentation generator invokes cargo internally. Its first default parallel
build was stopped when cgroup memory approached the container limit. Subsequent
Rust validation uses CARGO_BUILD_JOBS=1 and CARGO_PROFILE_DEV_DEBUG=0 /
CARGO_PROFILE_TEST_DEBUG=0. No OOM-killed compilation was repeated.
