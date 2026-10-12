# Native text command conformance

The JSON corpus defines identical stdin/argument/output/error cases for the
JavaScript and Rust head, tail, sort and uniq implementations. It covers empty
input, line endings, zero counts, malformed options, numeric sorting,
consecutive groups and composed uniq options. File, streaming, pipeline,
cancellation and compatibility-session tests supplement these cases.

Run from the repository root:

```bash
bun test js/tests/new-commands.test.mjs --timeout 10000
cargo test --manifest-path rust/Cargo.toml --test text_commands
```

To regenerate the corpus, run `python3 experiments/create-text-command-cases.py`
and format it with `js/node_modules/.bin/prettier --write conformance/text-commands/cases.json`.

The [migration guide](../../js/docs/SHELLJS_MIGRATION.md) describes the native
subset and the separate, pinned JavaScript ShellJS compatibility API.
