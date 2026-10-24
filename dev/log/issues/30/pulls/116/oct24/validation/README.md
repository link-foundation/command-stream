# October 24 validation

The main merge retains the lightweight JS core and shared command registry.
Six invalid-name cases failed before the fix; the expanded regression tests
exercise full/core ESM/CommonJS and direct registration without registry mutation.

- Focused packages, ecosystem, core entry and command builder suite: 44 passed.
- Full Rust all-features suite: 983 passed, 7 ignored, 0 failed across 64 suites.
- Full JavaScript suite with CI=true: 2,923 passed, 10 skipped, 0 failed across
  184 files (67,010 assertions; 196.93 seconds).
- Node builder/CommonJS/process/virtual-exit regressions: 26 passed.
- Node core-entry regressions: 5 passed, including the cold import graph.
- Node and Bun finite name-validation experiments passed.
- Real npm JavaScript and Rust discovery demos, both Rust demonstrations, and
  the isolated offline npm installation experiment passed. Discovery does not
  establish external package adoption.
- Repository ESLint, Prettier, strict TypeScript, Cargo formatting and duplication
  checks passed. The changed feature catalog also passes ESLint.
- All 98 direct dependency declarations are current or have an existing verified
  upstream blocker; installed npm dependencies have no outdated entries. Both
  Cargo lockfiles have no compatible updates pending.

Rust validation runs sequentially with CARGO_BUILD_JOBS=1,
CARGO_PROFILE_DEV_DEBUG=0 and CARGO_PROFILE_TEST_DEBUG=0. Cgroup memory.events
reported no out-of-memory kills. The first documentation check was interrupted
while its Cargo child waited for the full-test build lock; it must be rerun with
the same reduced-debug environment after the tests, rather than starting a
second default-debug build. This is a scheduling correction, not a source failure.

- Clippy (all targets/features) and rustdoc pass with warnings denied; no Cargo
  warning lines remain.
- All 37 feature examples pass executable parity in Rust, Node and Bun.
- Generated documentation is up to date (39 files). The corrected competitor
  descriptions render in Playwright; docs/screenshots/virtual-command-comparison.png
  captures the final page. The browser and local server were closed afterward.
- Final documentation validation passes: 257 tests and 265 assertions. The final
  repository formatter check passes after generation. Its initial run found only an
  ignored Playwright snapshot; the browser artifacts are archived under analysis
  rather than changing formatting policy.
- CI must check the pushed commit's SHA and creation time;
  old October 12 passing runs are not current evidence.
