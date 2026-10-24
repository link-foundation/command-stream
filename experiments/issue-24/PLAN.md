# Issue 24 / PR 122 work plan

- [x] Read the edited issue, PR body, conversation, review comments and reviews.
- [x] Verify branch and clean initial working tree; inspect recent Bun/zx PRs.
- [x] List CI runs with creation times and SHAs. The sole failure is the current
      2025 commit; logs return HTTP 410 and cannot be recovered.
- [x] Fetch main and start a forward merge; inspect JavaScript/Rust API layout.
- [x] Reproduce exact-argv, stdin and subprocess API defects before replacing
      the old facade. Preserve finite experiment scripts and local logs.
- [x] Resolve moved-file conflicts without losing current main functionality.
- [x] Add isolated Execa entry points and general API access, with complete
      upstream JavaScript behavior and explicit Rust portable counterparts.
- [x] Cover execution, options, input, streams, cancellation, errors, piping,
      IPC, packaging, CommonJS and declarations with executable tests.
- [x] Replace inaccurate comparison claims with reproducible benchmarks,
      migration docs, streaming/virtual examples and API limitations.
- [x] Add JavaScript changeset and Rust changelog fragment; update CI coverage.
- [x] Run focused tests, all local suites, lint/format/types/duplication, Rust
      fmt/clippy, feature parity and generated docs checks; save large logs.
- [x] Commit atomic validated work, push only issue-24-2ec0e8fa, update PR 122.
- [ ] Confirm fresh CI timestamps/SHAs, preserve failed logs and fix actual
      failures; review gh pr diff and clean status; mark PR 122 ready.
