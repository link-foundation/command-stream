# command-stream benchmarks

This suite measures the JavaScript implementation against the five APIs named
in [issue 29](https://github.com/link-foundation/command-stream/issues/29):
Execa, cross-spawn, ShellJS, zx, and Bun Shell. It uses deterministic fixtures,
checks every result before accepting its timing, and records raw statistics and
environment metadata in JSON.

The suite is a benchmark playground rather than a static claim about which
library is universally fastest. Results are only comparable within one report:
runtime, operating system, CPU load, package versions, and filesystem state all
affect them.

## Quick start

Install the pinned development dependencies and run the smoke profile:

```bash
cd js
bun install --frozen-lockfile
bun run benchmark:smoke
```

Run the complete suite with the default 30 measured and 5 warmup iterations:

```bash
bun run benchmark
```

Use the CLI to focus on a suite or implementation:

```bash
bun benchmarks/cli.mjs --list
bun benchmarks/cli.mjs --suite performance --adapter command-stream,execa
bun benchmarks/cli.mjs --suite real-world --iterations 50 --warmup 10
bun benchmarks/cli.mjs --suite bundle-size,features
```

Generated `benchmark-results.json` and `benchmark-report.html` files are placed
in `benchmarks/results/`. The HTML report contains expandable comparison tables
and relative-speed charts; CI uploads both files as workflow artifacts. On pull
requests after the suite reaches `main`, CI also runs the same smoke profile on
the base branch and produces `benchmark-regressions.json` and Markdown.

## What is measured

| Suite        | Measurements                                                                 |
| ------------ | ---------------------------------------------------------------------------- |
| Performance  | Exact-argv spawn latency, stdout throughput, concurrency, and failure paths. |
| Pipelines    | `pipe()` throughput versus an equivalent manual two-step command sequence.   |
| Output modes | command-stream buffering versus async iteration; built-in versus process.    |
| Bundle size  | npm pack size, installed production closure, minified bundles, import heap.  |
| Features     | Ported behavior and known-gap counts from immutable upstream test corpora.   |
| Real-world   | CI checks, log analysis, file hashing, and a local HTTP health check.        |

All process wrappers execute the same runtime, fixture, arguments, and expected
output in a scenario. The runner rotates adapter order between iterations to
reduce first-position bias and aborts immediately on a thrown error or invalid
result. Median time determines rankings; mean, min, max, standard deviation,
p95, p99, and operations per second remain available in JSON.

Package size uses `npm pack --dry-run --json` against installed, pinned package
versions. Installed footprint recursively counts production dependencies once.
The tree-shaking probe uses a minified esbuild bundle for both a namespace import
and the smallest primary API import. Bun Shell reports zero package bytes
because it ships with the runtime; that does not imply zero runtime cost.

Feature counts are not inferred from marketing tables. They come from the
executable mappings in `tests/competitor-compatibility.test.mjs` and the
explicit missing-feature ledger documented in
`docs/COMPETITOR_TEST_AUDIT.md`. Run `bun run test:competitors` to execute that
full compatibility suite.

## Migration quick reference

The smallest command-stream API depends on whether the old code needs shell
syntax or an exact argument vector:

```js
import { $, exec, sh } from 'command-stream';

await $`git status --short`;
const result = await exec('git', ['status', '--short'], {
  capture: true,
  mirror: false,
  stdin: 'ignore',
});
```

| Migrating from | Replace the common entry point with                                   |
| -------------- | --------------------------------------------------------------------- |
| Execa          | `exec(file, args, options)` for exact arguments                       |
| cross-spawn    | `exec(file, args, options)` for a collected promise result            |
| ShellJS        | `sh(command, options)` for shell syntax, or `exec()` for exact args   |
| zx             | `` $`command ${value}` ``; interpolation remains a single safe value  |
| Bun Shell      | `` $`command ${value}` ``; result objects also expose async `.text()` |

There are two defaults to review during migration. Output is mirrored unless
`mirror: false` is set, and non-zero exits are returned unless errexit is
enabled. The [main README](../README.md) documents streaming, events, pipelines,
synchronous execution, and error handling in detail. The feature report's
known-gap list is the source of truth for behavior that does not yet have a
direct replacement.

## CI profiles

Pull requests run unit tests plus matching base/head smoke profiles. Changes of
at least 15% and 2 ms are classified for review. Pushes to `main`, the weekly
schedule, and manual dispatch run the full profile and retain the JSON/HTML
artifact. Timing classifications are intentionally informational: noisy shared
runners should not reject code based on a single percentage threshold.

The smoke profile uses smaller suite-specific iteration counts. Every scenario
records its effective measured and warmup counts in JSON; `runnerDefaults`
records the CLI defaults used by scenarios that do not override them.
