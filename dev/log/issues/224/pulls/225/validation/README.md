# Validation evidence for issue 224

Large local command logs remain in this directory and are ignored. In particular,
tracing can include the inherited environment and is not suitable for publishing.
The finite memory samples are preserved as JSON; their methodology and limits
are in [the measurements](../analysis/measurements.md).

Reproduction precedes implementation:

- `advanced-red.log`: missing builder, translator, terminal buffer, packages,
  stream operators, and development APIs fail the focused acceptance tests.
- `pressure-red-node.log` and `pressure-red-bun.log`: a paused consumer allows
  all 200 generator chunks to be produced through the old native pipeline.
  `experiments/issue-224/pipeline-pressure.mjs` now retains all 3,276,800 bytes
  while pausing upstream production in both runtimes.
- `inherited-stdin-red.log`: an open parent stdin keeps a completed child alive
  past the finite watchdog. The integration test now verifies forwarding EOF
  and releasing an idle inherited stdin pump when the child exits.
- `merge-cancel-red.log`: closing a merged stream waits for an idle child to
  complete instead of interrupting its pending read. Cancellation now propagates
  through line framing and operators before queued iterator cleanup is awaited.
- `pipeline-cancellation-red-node.log` and `pipeline-cancellation-red-bun.log`:
  a native stage that ignores SIGTERM survives mixed-pipeline cancellation.
  The finite probe now verifies process-tree escalation in both runtimes.
- `editor-escapes-red.log`: the editor's overlapping regexp alternatives stall
  on 32 escape sequences before the bounded worker watchdog terminates it.
  Disjoint alternatives complete the same scan immediately.
- `disabled-virtual-red.log`: starting the development suite after native-only
  suites reproduces the CI failures (empty REPL output and mock exit code 127).
  The new suites now use the existing before/after cleanup hooks. Watched fixture
  saves use atomic rename so a zero-debounce watcher cannot read a partial write.
- `watch-symlink-red.log`: a linked watch directory reproduces the remaining
  macOS CI failure: package reload is skipped because watched and installed
  paths have different identities. Canonicalizing the watch root makes the
  same test pass; the finite Node/Bun `watch-symlink.mjs` probe verifies reload.
- `watch-package-identity-red.log`: Node's `--preserve-symlinks` option retains
  the package's logical entry path. Explicit canonical entry resolution makes
  the same automated reload regression pass with that option as well.

The regression tests are in `js/tests/advanced-*.test.mjs`,
`command-packages.test.mjs`, `development-tools.test.mjs`,
`terminal-buffer.test.mjs`, the corresponding Rust integration targets, and
the existing compatibility/type/artifact suites.

Final test counts and CI status are recorded in the pull request description.

Local verification: 2,688 Bun tests and 838 Rust tests passed; 104 Node core
checks and 524 Node zx/Execa tests passed. All 34 feature examples passed
Node/Bun/Rust execution checks, and all 211 documentation checks passed.
Lint, formatting, declarations, duplication, Rust Clippy/rustdoc, npm artifacts
and VSIX packaging passed. Existing skip/ignore counts are documented in the PR.
