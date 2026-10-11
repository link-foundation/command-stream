# Issue 224 reproducible probes

Run from the repository root with JavaScript dependencies installed:

```sh
node --max-old-space-size=128 experiments/issue-224/pipeline-pressure.mjs
bun experiments/issue-224/pipeline-pressure.mjs
node --max-old-space-size=128 experiments/issue-224/stream-memory.mjs stream
node --max-old-space-size=128 experiments/issue-224/stream-memory.mjs buffer
node experiments/issue-224/fy-stdin.mjs
```

The pipeline and memory probes use finite inputs. The first asserts upstream
backpressure, complete delivery, and disabled capture in both runtimes. Run memory
modes separately; the Node heap limit bounds each process. The stdin probe traces
inherited EOF forwarding for the generated module's stdin behavior. Traces can
include the process environment, so review them before sharing.

See [requirements and design](../../dev/log/issues/224/pulls/225/analysis/requirements.md),
[measurements](../../dev/log/issues/224/pulls/225/analysis/measurements.md), and the
[advanced workflows guide](../../js/docs/ADVANCED-WORKFLOWS.md). Automated regressions
live in `js/tests/advanced-*.test.mjs` and the package, development, and terminal
buffer suites; the cross-runtime pipeline experiment runs from the integration test.
