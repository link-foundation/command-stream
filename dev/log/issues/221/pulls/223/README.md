# Issue 221 / PR 223 evidence

`consumer-before.json` is a clean npm consumer of the published 2.0.0 release:
both runtime ShellJS packages reach fast-glob, micromatch and braces, with six
high severity findings. `consumer-after.json` is a clean consumer of the packed
fix: the chain is empty and the audit reports zero vulnerabilities. No consumer
override or advisory exclusion was used.

`regression-before.log.gz` records all three production dependency contract tests
failing before implementation. The committed tests also verify configuration,
commands, pipelines, plugins, excessive nesting and bounded brace expansion.

`glob-parity-before.log.gz` and `glob-parity-after.txt` preserve the upstream
comparison failures and the passing comparison after the adapter corrections.
`node22-esm-before.log.gz` and `node22-esm-after.txt` show the draft import failure
and successful ESM execution on Node 22.0.0 after the runtime bridge correction.

`dependency-freshness-38094949858.log.gz` is the initial failed CI log, downloaded
from run 38094949858 (2026-10-10T23:25:03Z, head 04f5dac). Lines 640–646 name the
serde_json 1.0.151 declarations that had become stale against 1.0.152. The fix
updates all six library, benchmark and release-script declarations and both
lockfiles. The direct-dependency check then reports 89 checked and zero stale.

Reproduction commands and bounded probes are documented in
`experiments/issue-221/README.md`. Compressed logs are byte-preserving copies of
the investigation output; use `gzip -dc filename.log.gz` to inspect them.

`bun-suite.log.gz` records 2,619 passing tests, ten skips and no failures.
`node-core.log.gz`, `node-zx.log.gz` and `node-execa.log.gz` record 104, 490 and
38 passing tests respectively (two zx skips). `rust-tests.log.gz` and
`rust-benchmark-tests.log.gz` preserve the passing Rust suites. `checks.log.gz`
records the repository lint, format, duplication and TypeScript checks.
`feature-parity.txt` covers all 29 features; `documentation.txt` verifies the
generated documentation. The production matrix logs cover all three install
modes on Node 22, 24 and 26, for local/global runtime and isolated declarations.
