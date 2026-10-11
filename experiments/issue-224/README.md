# Issue 224 reproducible probes

Run from the repository root with JavaScript dependencies installed:

```sh
node --max-old-space-size=128 experiments/issue-224/pipeline-pressure.mjs
bun experiments/issue-224/pipeline-pressure.mjs
node experiments/issue-224/pipeline-cancellation.mjs
bun experiments/issue-224/pipeline-cancellation.mjs
node experiments/issue-224/editor-escapes.mjs
node experiments/issue-224/watch-symlink.mjs
node --preserve-symlinks experiments/issue-224/watch-symlink.mjs
bun experiments/issue-224/watch-symlink.mjs
bun test --preload ./experiments/issue-224/disabled-virtual-preload.mjs js/tests/development-tools.test.mjs
node --max-old-space-size=128 experiments/issue-224/stream-memory.mjs stream
node --max-old-space-size=128 experiments/issue-224/stream-memory.mjs buffer
node experiments/issue-224/fy-stdin.mjs
```

The pipeline and memory probes use finite inputs. The first asserts upstream
backpressure, complete delivery, and disabled capture in both runtimes. Run memory
modes separately; the Node heap limit bounds each process. The stdin probe traces
inherited EOF forwarding for the generated module's stdin behavior. Traces can
include the process environment, so review them before sharing.

The cancellation fixture exits by itself after 500ms and verifies that cancelling
a mixed pipeline also stops a native stage that ignores SIGTERM. The editor probe
uses 32 escape sequences in a worker capped at 16 MiB, terminates the worker after
a 500ms watchdog, and checks diagnostics on an unclosed template.

The symlink watcher probe checks canonical package identity and reloads through
a linked workspace (a Windows junction on Windows), with a two-second watchdog.

See [requirements and design](../../dev/log/issues/224/pulls/225/analysis/requirements.md),
[measurements](../../dev/log/issues/224/pulls/225/analysis/measurements.md), and the
[advanced workflows guide](../../js/docs/ADVANCED-WORKFLOWS.md). Automated regressions
live in `js/tests/advanced-*.test.mjs` and the package, development, and terminal
buffer suites; the cross-runtime pipeline experiment runs from the integration test.
