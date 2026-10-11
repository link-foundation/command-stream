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
