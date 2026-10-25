# Windows integration deadline

Rust run `40136191529` for `4a7325534afd9ac2e57f13157eb1035e5c54f0db`
failed job `120998498696` at 2026-10-24T22:03:09Z. The job log's lines
1693–1694 report `Elapsed(())` at `tests/example_packages.rs:132`, the single
five-second timeout surrounding Git initialization, Git status, and HTTP.
No functional assertion failed before the deadline. Full run/job logs are
downloaded under `ci-logs/issue-30`; the job is archived in `evidence/`.

The unchanged neighboring manifest process suite took 23.32 seconds, compared
with 2.14 seconds in the prior passing Windows run (`40133294691`, job
`120990138622`). The combined Git/HTTP example previously took 0.22 seconds.
This supports runner/process latency as a cause, but the original bare timeout
does not identify which stage was slow. It must not be described as proof that
curl or Git itself malfunctioned.

`python3 experiments/issue-30/slow-git.py` injects exactly three seconds before
each real Git process, with no unbounded load or memory allocation. Before the
fix the existing test fails with the same `Elapsed(())` after 5.01 seconds.
After the fix it passes in 6.11 seconds: Git init takes 3.05 seconds and the
registered git-summary command takes 3.05 seconds. The actual Git executable,
temporary repository, virtual command and output assertions are retained.

Git and HTTP are now independent integration tests. Each external operation
keeps a five-second limit; neither individual deadline nor the CI job timeout
is increased. Captured stage names and completion timings make any subsequent
timeout specific. The independent HTTP test still starts a real local server,
executes the installed http-get command and asserts its exact response.
The Linux Rust CI job also runs the bounded real-Git latency experiment, reusing
the preceding test build, so the shared-budget regression is checked on every PR.

Before/after latency experiment logs and the failing Windows job are archived
under `evidence/`. Fresh full-suite and platform results are recorded in PR #116.
