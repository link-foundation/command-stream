# Changelog

## 0.11.1

### Patch Changes

- a8caefd: Fix false-positive releases and the "failed to deploy" restart in the JavaScript
  release pipeline (issue #166):
  - `publish-to-npm.mjs`: only report success when output-scan, exit code, and an
    `npm view` registry check all agree — a failed `changeset publish` (e.g. npm
    E404) can no longer create a GitHub release for a version that never reached
    npm.
  - `check-release-needed.mjs`: always probe npm and emit `current_unpublished`,
    so a version that was committed to `main` but never published self-heals on the
    next push regardless of changeset state (closes the restart that "failed to do
    any deploy").
  - New `wait-for-npm.mjs` step verifies, after publish, that the exact version is
    actually installable from npm — turning any "tagged but not on npm" divergence
    into a hard CI failure.
  - `setup-npm.mjs` now asserts npm ≥ 11.5.1 (required for OIDC trusted
    publishing) and `create-github-release.mjs` caps the release-notes body and is
    idempotent on an already-existing release.

## 0.11.0

### Minor Changes

- Add `literal()` function to preserve apostrophes in shell arguments

  When passing text containing apostrophes to programs that store it literally (like API calls via CLI tools), apostrophes would appear corrupted as triple quotes (`'''`). The new `literal()` function uses double-quote escaping which preserves apostrophes while still escaping shell-dangerous characters.

  **New features:**
  - `literal(value)` - Mark text for double-quote escaping, preserving apostrophes
  - `quoteLiteral(value)` - Low-level function for manual command building

  **Usage:**

  ```javascript
  import { $, literal } from 'command-stream';

  // Apostrophes now preserved for API storage
  const notes = "Dependencies didn't exist";
  await $`gh release create --notes ${literal(notes)}`;
  ```

## 0.10.2

### Patch Changes

- 7185b33: Prevent false-positive GitHub releases when the npm publish actually failed
  (#166). `scripts/publish-to-npm.mjs` relied on command-stream's `$` throwing on
  a non-zero exit, but `$` does not throw by default (errexit is off, see #156),
  so a failed `changeset publish` (e.g. an npm E404) was still reported as
  `published=true` and a GitHub release was created for a version that never
  reached npm. The publish step now confirms success with three independent
  checks — output-pattern scan, exit code, and an `npm view` registry
  verification — and fails the job otherwise. `scripts/create-github-release.mjs`
  and `scripts/version-and-commit.mjs` were hardened against the same
  non-throwing-`$` false-positive class.

## 0.10.1

### Patch Changes

- b5f7309: Update the JavaScript release workflow to the action versions used by the
  pipeline templates (`actions/checkout@v6`, `actions/setup-node@v6`,
  `peter-evans/create-pull-request@v8`), clearing the Node.js 20 deprecation
  warnings emitted by GitHub Actions.

## 0.10.0

### Minor Changes

- a6f0693: Add chainable `.quiet()` method on `ProcessRunner` to suppress console output
  (mirroring) for a single command while still capturing its result, matching the
  behavior of zx's `quiet()` (issue #136).

  ```javascript
  // Suppress console output but still capture the result
  const result = await $`gh api gists/${gistId} --jq '.files'`.quiet();
  ```

## 0.9.6

### Patch Changes

- Ensure the JavaScript release job still evaluates on main pushes after the
  pull-request-only changeset gate is skipped.

  Separate JavaScript package metadata, scripts, documentation, and release tags
  from the Rust crate release path.

## 0.9.5

### Patch Changes

- Document try/catch anti-pattern with errexit=false default (issue #156)
  - Add js/docs/case-studies/issue-156/README.md with comprehensive case study including:
    - Reconstructed timeline and sequence of events from calculator#78 silent bug
    - Root cause analysis with code evidence from command-stream source
    - Bash vs command-stream behavior comparison table
    - Full configuration API documentation (shell.errexit(), set(), unset())
    - Recommended patterns for mixed strict/optional error handling
    - Comparison with similar libraries (execa, zx, bash, child_process)
    - Proposed solutions ranked by impact
  - Add Pitfall #7 to js/BEST-PRACTICES.md: try/catch anti-pattern with errexit=false, with examples and correct fix patterns
  - Add 4 reproducible experiment scripts in experiments/issue-156/:
    - 01-default-behavior.mjs — demonstrates default errexit=false behavior
    - 02-errexit-enabled.mjs — demonstrates shell.errexit(true) configuration
    - 03-bash-comparison.sh — bash set -e reference comparison
    - 04-calculator-bug-repro.mjs — exact reproduction of calculator#78 bug

  Publish the Rust crate from CI, sync Cargo release versions, and harden shell option isolation in Bun tests.

## 0.9.4

### Patch Changes

- 3265939: Document Array.join() pitfall and add best practices (fixes #153)
  - Add js/BEST-PRACTICES.md with detailed usage patterns for arrays, security, and error handling
  - Add Common Pitfalls section to README.md explaining the Array.join() issue
  - Add js/docs/case-studies/issue-153/ with real-world bug investigation from hive-mind#1096
  - Add rust/BEST-PRACTICES.md for Rust-specific patterns
  - Add 34 tests for array interpolation covering correct usage and anti-patterns
  - Reorganize file structure: move JS-related docs to js/ folder, case studies to js/docs/case-studies/

## 0.9.2

### Patch Changes

- 535eb02: Reorganize Rust code with modular utilities (matching JS pattern)
  - Extract trace.rs (152 lines) - Logging and tracing utilities
  - Extract ansi.rs (194 lines) - ANSI escape code handling
  - Extract quote.rs (161 lines) - Shell quoting utilities
  - Update utils.rs to re-export from new modules and focus on CommandResult/VirtualUtils
  - Update lib.rs with new module declarations and re-exports

  The Rust structure now mirrors the JavaScript modular organization for consistency.
  All modules remain well under the 1500-line limit guideline.

## 0.9.1

### Patch Changes

- 38dc1c3: Reorganize codebase with modular utilities for better maintainability
  - Extract trace/logging utilities to $.trace.mjs
  - Extract shell detection to $.shell.mjs
  - Extract stream utilities to $.stream-utils.mjs and $.stream-emitter.mjs
  - Extract shell quoting to $.quote.mjs
  - Extract result creation to $.result.mjs
  - Extract ANSI utilities to $.ansi.mjs
  - Extract global state management to $.state.mjs
  - Extract shell settings to $.shell-settings.mjs
  - Extract virtual command registration to $.virtual-commands.mjs
  - Add commands/index.mjs for module exports
  - Update $.utils.mjs to use shared trace module

  All new modules follow the 1500-line limit guideline. The Rust code
  structure already follows best practices with tests in separate files.

## 0.9.0

### Minor Changes

- 60e2a36: Add Rust translation and reorganize codebase
  - Reorganize JavaScript source files into `js/` folder structure
  - Move tests from root `tests/` to `js/tests/`
  - Add complete Rust translation in `rust/` folder with:
    - Shell parser supporting &&, ||, ;, |, (), and redirections
    - All 21 virtual commands (cat, cp, mv, rm, touch, mkdir, ls, cd, pwd, echo, yes, seq, sleep, env, which, test, exit, basename, dirname, true, false)
    - ProcessRunner for async command execution with tokio
    - Comprehensive test suite mirroring JavaScript tests
    - Case study documentation in docs/case-studies/issue-146/

## 0.8.3

### Patch Changes

- 0e1c9e0: Fix trace logs interfering with output when CI=true
  - Removed automatic trace log enabling when CI environment variable is set
  - Trace logs no longer pollute stderr in CI/CD environments (GitHub Actions, GitLab CI, etc.)
  - Added COMMAND_STREAM_TRACE environment variable for explicit trace control
  - COMMAND_STREAM_TRACE=true explicitly enables tracing
  - COMMAND_STREAM_TRACE=false explicitly disables tracing (overrides COMMAND_STREAM_VERBOSE)
  - COMMAND_STREAM_VERBOSE=true continues to work as before
  - JSON parsing works reliably in CI environments

  Fixes #135

## 0.8.2

### Patch Changes

- b3dac3d: Add Windows shell detection support
  - Added Windows-specific shell detection (Git Bash, PowerShell, cmd.exe)
  - Use 'where' command on Windows instead of 'which' for PATH lookups
  - Fallback to cmd.exe on Windows when no Unix-compatible shell is found
  - Updated timing expectations in tests for slower Windows shell spawning
  - Created case study documentation for Windows CI failures (Issue #144)

## 0.8.1

### Patch Changes

- Test patch release

## 0.8.0

### Minor Changes

- f4dbb49: Transition to new CI/CD template with modern best practices

  Features:
  - Changeset-based versioning for semantic version management
  - OIDC trusted publishing to npm (no tokens required)
  - Manual and automatic release workflows
  - Multi-platform testing (Ubuntu, macOS, Windows)
  - Node.js compatibility testing (v20, v22, v24)
  - ESLint + Prettier with Husky pre-commit hooks
  - Code duplication detection with jscpd
  - Consolidated release workflow for all publishing

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.7.1

### Patch Changes

- Current stable release with streaming support, async iteration, and EventEmitter support
