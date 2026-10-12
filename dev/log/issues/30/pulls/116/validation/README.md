# Initial local validation (87e931f)

- Full Bun suite with CI=true and jq installed: 2,753 passed, 10 skipped,
  0 failed (173 test files, 224.33 seconds).
- Focused package, integration and ecosystem acceptance tests: 40 passed,
  0 failed, including tracing-enabled invalid composition. The saved
  ecosystem-focused.log.gz contains exact output.
- The six invalid-name cases failed before the fix; see
  ../analysis/name-validation-before.log.gz.
- The finite name-validation experiment passes through ESM/CommonJS in Node
  26.11.1 and Bun 1.4.3. Both offline demonstrations pass in Node and Bun.
- Full repository ESLint, Prettier, strict TypeScript declarations, and
  duplication checks passed (2.51% duplicated lines).
- Documentation validation passed: 221 checks, 0 failed. New documentation
  is included in the tracked-file checks.
- Rust all-features suite: 855 passed, 7 ignored, 0 failed across 53 suites,
  including documentation examples. The single-job build used reduced debug
  data and completed in 4 minutes 52 seconds; peak process RSS was 619 MiB.
- All 34 executable feature comparisons passed in Rust, Node and Bun.
- Generated documentation checks passed for all 36 generated files.

The initial source fix addressed JavaScript overload/coercion validation, with
Rust's existing portable behavior tested separately. The follow-up review
requires removing the exemption and expanding Rust support and coverage; see
the Rust ecosystem guide and the follow-up validation recorded below.

## Language parity follow-up

- Full Bun suite: 2,753 passed, 10 skipped, 0 failed; 66,515 assertions across
  173 files. `follow-up-js-all.log.gz` preserves the output.
- Full Rust all-features suite: 876 passed, 7 ignored, 0 failed across 56 suites,
  including compile-fail interface doctests. `follow-up-rust-all.log.gz` preserves
  the output. Builds used one Cargo job and disabled compiler debug data.
- Focused Rust ecosystem suites: 21 passed, 0 failed. Coverage includes bounded
  middleware/inheritance, streamed composition, manifest ownership/reload,
  actual curl HTTP requests, real offline npm installation, watching/shutdown,
  ten example packages, split UTF-8 and paused-consumer cancellation.
- Rust formatting, all-target/all-feature Clippy with warnings denied, and API
  documentation with rustdoc warnings denied passed.
- JavaScript ESLint, strict declaration checks, Prettier and duplication checks
  passed; duplicated source remains 2.51%.
- Finite Node/Bun ESM/CommonJS validation and the offline npm installation
  experiment passed. Existing JavaScript APIs and Rust typed handlers are retained.
- All 34 executable feature comparisons passed in Rust, Node and Bun; package
  comparisons now cover five shared observations. Generated documentation was
  current for all 36 files, and 227 documentation validation checks passed.
- Both new Rust ecosystem/enterprise demonstrations completed successfully.

The first final Rust run encountered an existing graceful-shutdown test failure:
`follow-up-rust-first-final.log.gz`, lines 401–404, expected status 0 but received
-1. That unchanged test passed in isolation and the complete suite passed on
rerun. The initial failure and focused rerun are preserved; no timeout increase,
test weakening, or unrelated process-runner change was made.

## CI dependency freshness follow-up

CI required a compatible syn update from 3.0.8 to 3.0.9 in both Rust lockfiles.
After refreshing them, all 876 Rust tests passed again (7 ignored), all-target
Clippy passed with warnings denied, and the benchmark crate compiled successfully.
The dependency declaration check verified all 90 direct dependencies without
stale or unverifiable entries. Updated-build logs are retained below this file;
the failed CI log and precise error locations are retained with the investigation.

The Linux offline npm fixture subsequently hit its unchanged fifteen-second
deadline in CI while macOS, Windows and prior Linux/local runs passed. Its private
cache, disabled update checks, and retained verbose failure diagnostics now make
the offline integration independent of shared npm state and failures reviewable.
After that isolation, focused tests and the reusable experiment passed, Clippy
passed, and all 876 Rust tests passed again. No deadline was increased.
