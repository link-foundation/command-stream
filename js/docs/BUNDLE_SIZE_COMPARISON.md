# Reproducible size and streaming comparisons

The Execa-compatible entry delegates to Execa 10.1.0. It provides compatibility,
not a smaller replacement implementation. It adds Execa's production dependency
closure to the package. The old draft's “20 KB”, “60% smaller” and “zero
dependencies” claims did not measure the current package and have been removed.

The native, Bun, zx and Execa APIs are separate entry points. The general entry
loads the zx and Execa layers only when used. Native imports also include the
package's terminal dependencies, so compare actual bundles and production
install sizes rather than a single source file.

Run the existing benchmark framework from `js/`:

```sh
bun benchmarks/cli.mjs --suite bundle-size --output ../ci-logs/execa-bundle
```

The `bundle-size` suite reports `npm pack` sizes, the recursive production
install footprint, minified esbuild bundles, and fresh-process import memory.
It now measures `command-stream/execa` alongside native command-stream,
`command-stream/zx` and Execa. The full Execa-compatible bundle includes Execa
plus the small factory extension; its minimal import is the same upstream
function. Package archive sizes for entries in the same package are shared.

For a finite latency comparison from the repository root:

```sh
node js/examples/streaming-benchmarks.mjs
```

This prints JSON with time to first output, time to completion, bytes observed
and whether the first chunk arrived before completion. It measures native
streaming, Execa streaming and explicitly buffered Execa execution using the
same producer. Execa's streaming mode is included because Execa supports it.
There are no timing pass/fail thresholds or claims that one library always wins.
Producer delay and process startup dominate this deliberately small example.

A Linux x64 snapshot with Bun 1.4.2 and esbuild 0.28.2 measured the following
minified Node bundles (bytes, before compression):

| Entry                  | All exports | Minimal `execa` import |
| ---------------------- | ----------: | ---------------------: |
| `command-stream/execa` |     117,547 |                117,177 |
| Execa 9.6.1            |     116,761 |                116,433 |

The [measurement snapshot](../../experiments/issue-24/bundle-size.json) records
the environment and package/dependency sizes. These figures describe that
checkout; regenerate them after source or dependency changes. They do not imply
that the entire command-stream package is smaller than Execa.
