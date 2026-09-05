# CI run evidence for issue #199

Downloaded with `gh run view <id> --log`. Full logs are committed **gzipped**
(`*.log.gz`, ~1.2 MB total instead of ~9.8 MB) following the precedent set by
`docs/case-studies/issue-166/ci-logs/`. Read one with:

```bash
gunzip -c dev/log/issues/199/pulls/200/ci-logs/run-33914574283.log.gz | less
```

Per-run metadata (workflow, conclusion, per-job conclusions) is in
`../api/run-<id>.json`.

| Run | Workflow | Branch | Commit | Event | Created (UTC) | Conclusion | Failed jobs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [33897699209](https://github.com/link-foundation/command-stream/actions/runs/33897699209) | JavaScript checks and release | `main` | `7e2b7018` | push | 2026-09-04T16:54:18Z | failure | `Release JavaScript package` |
| [33910180248](https://github.com/link-foundation/command-stream/actions/runs/33910180248) | JavaScript checks and release | `issue-197-b748bb92cd2d` | `e6a3eef7` | pull_request | 2026-09-04T19:15:05Z | failure | `Test JavaScript (bun on macos-latest)`, `Test JavaScript (bun on ubuntu-latest)`, `Test JavaScript (bun on windows-latest)` |
| [33910180769](https://github.com/link-foundation/command-stream/actions/runs/33910180769) | Rust checks and release | `issue-197-b748bb92cd2d` | `e6a3eef7` | pull_request | 2026-09-04T19:15:06Z | failure | `Test Rust (macos-latest)`, `Test Rust (windows-latest)` |
| [33911660942](https://github.com/link-foundation/command-stream/actions/runs/33911660942) | Rust checks and release | `issue-197-b748bb92cd2d` | `f9bf3dec` | pull_request | 2026-09-04T19:32:11Z | failure | `Test Rust (macos-latest)` |
| [33911660947](https://github.com/link-foundation/command-stream/actions/runs/33911660947) | JavaScript checks and release | `issue-197-b748bb92cd2d` | `f9bf3dec` | pull_request | 2026-09-04T19:32:11Z | failure | `Test JavaScript (bun on macos-latest)` |
| [33914574263](https://github.com/link-foundation/command-stream/actions/runs/33914574263) | Rust checks and release | `main` | `000dbeab` | push | 2026-09-04T20:06:37Z | success | — |
| [33914574283](https://github.com/link-foundation/command-stream/actions/runs/33914574283) | JavaScript checks and release | `main` | `000dbeab` | push | 2026-09-04T20:06:37Z | failure | `Release JavaScript package` |
