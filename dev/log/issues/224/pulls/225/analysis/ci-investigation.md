# CI investigation for issue 224

The inspected runs started at 2026-10-11 07:35:12 UTC on commit
`3a82674e8c49bf2a7ebea9b03d8deea5e84dde4d`, after that commit was pushed.
The run listing records the SHA and creation timestamp so earlier runs cannot
be mistaken for validation of a newer fix. Full logs are preserved locally in
`ci-logs/`; they are excluded from Git because traces can contain environments.

## JavaScript workflow 38121869117

The [workflow](https://github.com/link-foundation/command-stream/actions/runs/38121869117)
failed in the Bun suites on all three operating systems. Node compatibility,
process-tree checks, production installations, and the other completed jobs passed.

- `javascript-38121869117.log:41362` reports Linux package reload expected
  `after-longer`, received an empty string. Lines 41401 and 41432 report empty
  output from the installed math package and the regular virtual stream.
- The equivalent Windows failures appear at lines 33371, 33410, and 33441.
- macOS line 25942 reports the old `before` package value; lines 31394 and
  31428 report empty REPL output and mock command exit status 127.

Existing native-command suites intentionally disable the shared virtual command
registry. The new suites lacked the existing before/after state-reset hooks, so
results depended on test-file order. Preloading
`experiments/issue-224/disabled-virtual-preload.mjs` reproduces the REPL and mock
failures locally. With cleanup hooks installed, all five affected new suites pass
the same preload. The zero-debounce watcher fixture now uses atomic rename,
matching an editor's atomic save and preventing reads during file truncation.

## CodeQL check 114418397064

The Security workflow itself succeeded. Its log lines 5039–5052 show analysis
results exported, uploaded and processed; the separate CodeQL check failed on
the uploaded findings. Its annotations and bot review comments identify:

- [Inefficient regular expression](https://github.com/link-foundation/command-stream/pull/225#discussion_r4240727882)
  at `extensions/vscode-command-stream/src/extension.cjs:45`. Overlapping escape
  alternatives permit exponential backtracking. The worker in
  `experiments/issue-224/editor-escapes.mjs` reproduces a stall with 32 escape
  sequences, a 16 MiB worker limit and a 500ms watchdog. Disjoint alternatives
  complete the same probe.
- [Improper code sanitization](https://github.com/link-foundation/command-stream/pull/225#discussion_r4240727892)
  at `js/tests/advanced-integration.test.mjs:120`. The watcher fixture now uses
  static module source instead of interpolating a value into JavaScript.

The temporary warning about the Rust analysis configuration occurred while that
matrix job was still running. Final verification must inspect all checks on the
latest pushed SHA, including the separate CodeQL findings check.

## macOS watcher failure in workflow 38122846046

The [next JavaScript run](https://github.com/link-foundation/command-stream/actions/runs/38122846046)
started at 2026-10-11 07:52:31 UTC on
`f582557a5665f48cfb13ddc740a9e26d64489108`. Linux and Windows Bun suites passed;
macOS retained the old package output. The log
`javascript-38122846046.log:24596` expects `after-longer`, while line 24597
receives `before`. Both CodeQL findings are now marked fixed.

Package resolution canonicalizes symlinks, but the watcher retained its caller's
logical directory. Therefore `files.includes(installed.file)` skipped reload
when the watch directory used a different spelling of the same location. The
symlinked-directory regression reproduces the exact stale value on Linux too.
Canonicalizing the watch root before its initial snapshot gives both systems
the same file identity. The same test and finite Node/Bun probe pass afterward.
The additional `--preserve-symlinks` probe reproduces the inverse mismatch when
module resolution preserves a logical package path. Package entry paths now
canonicalize explicitly, sharing install/reload/watch identity in either mode.
`watch-package-identity-red.log` records the failing automated regression before
that fix; the same test passes after normalization.

This matches [Node's module resolution](https://nodejs.org/api/modules.html#all-together),
which resolves symlinks, and [fs.realpath](https://nodejs.org/api/fs.html#fspromisesrealpathpath-options),
which computes a canonical pathname. The test also uses a Windows junction so
the final CI matrix verifies the fix there without symlink elevation.
