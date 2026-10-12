# Local validation

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

The source fix is JavaScript-specific overload/coercion validation. Rust source
is unchanged; its portable packages, inheritance, middleware and composition
remain included from main. Rust tests and executable cross-language examples
passed separately with one build job and reduced debug data.
