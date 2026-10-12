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

The source fix is JavaScript-specific overload/coercion validation. Rust source
is unchanged; its portable packages, inheritance, middleware and composition
remain included from main. Rust tests and executable cross-language examples
are validated separately with one build job and reduced debug data.
