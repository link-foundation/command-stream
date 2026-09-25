# command-stream Rust benchmarks

This package measures the Rust implementation against `std::process`, Tokio
process, async-process, duct, subprocess, and xshell. Every timed operation runs
the same executable and arguments and validates its output before the sample is
accepted. Versions are pinned in `Cargo.lock`.

The reports are a reproducible benchmark playground, not a universal speed
claim. Compare implementations within one report: hardware, operating system,
toolchain, CPU load, and filesystem state all affect timings.

## Quick start

From the `rust/` directory, run the CI-sized profile:

```bash
cargo run --release --locked --manifest-path benchmarks/Cargo.toml -- --smoke
```

Run the complete profile with 30 measured iterations and 5 warmups:

```bash
cargo run --release --locked --manifest-path benchmarks/Cargo.toml
```

Focus on a suite or API with the CLI:

```bash
cargo run --release --locked --manifest-path benchmarks/Cargo.toml -- --list
cargo run --release --locked --manifest-path benchmarks/Cargo.toml -- \
  --suite performance --adapter command-stream,xshell
cargo run --release --locked --manifest-path benchmarks/Cargo.toml -- \
  --suite crate-size,features
```

Reports are written to `benchmarks/results/benchmark-results.json` and
`benchmark-report.html`. CI uploads both. Once the suite exists on the base
branch, pull requests also benchmark base and head with the same smoke profile
and produce machine-readable and Markdown comparisons.

## Measurements

| Suite       | Measurements                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| Performance | Exact-argument spawn latency, buffered stdout, concurrency, and nonzero exits.                               |
| Rust APIs   | command-stream buffering versus streaming, pipeline versus manual handoff, and built-in versus spawned echo. |
| Crate size  | Resolved crate source bytes and unique transitive source-closure bytes.                                      |
| Features    | Ported behavior and known-gap counts from immutable upstream Rust test corpora.                              |
| Real-world  | Parallel CI checks, log analysis, file hashing, and a local HTTP health check.                               |

In the output-mode comparison, the buffered case collects the full result.
The streaming case counts each chunk without retaining the complete output,
matching the JavaScript suite's `capture: false` streaming setup.

The timing runner rotates API order to reduce first-position bias and records
mean, median, min, max, standard deviation, p95, p99, and operations per second.
Median determines the ranking. A failed process or invalid output aborts the
scenario instead of recording a misleading sample.

Crate footprint is computed from `cargo metadata --locked`. It counts each
resolved source tree once, excludes VCS/build output and this benchmark package,
and reports `std::process` as zero because it ships with Rust. It measures source
footprint, not final binary size; compiler settings and which APIs an application
uses determine binary size.

Feature counts come directly from `tests/competitor_dispositions.jsonl`, which
pins upstream sources to immutable commits and records both executable ports and
explicit gaps. Run `cargo test --test competitor_compatibility` in `rust/` to
execute that compatibility corpus.

## Base/head comparison

Compare two generated reports:

```bash
cargo run --release --locked --manifest-path benchmarks/Cargo.toml \
  --bin compare -- \
  --baseline benchmarks/baseline/benchmark-results.json \
  --current benchmarks/results/benchmark-results.json \
  --output benchmarks/results
```

The default review signal is a change of at least 15% and 2 ms. Classification
is informational because shared CI machines are noisy; confirm possible
regressions with repeated runs on a controlled host.
