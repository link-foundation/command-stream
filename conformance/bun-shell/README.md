# Bun Shell conformance corpus

A **language-neutral** corpus (plain JSON data) that reproduces every upstream
[Bun Shell](https://bun.sh/docs/runtime/shell) (`Bun.$`) test unit, so that the
JavaScript (`js/`) and Rust (`rust/`) implementations of command-stream can be
checked for feature parity against the same expectations
(issue [#27](https://github.com/link-foundation/command-stream/issues/27)).

## Provenance

- Upstream: [oven-sh/bun](https://github.com/oven-sh/bun) at pinned commit
  `09bb5463058074ef143a9d9a5a405d669c787375`, every `*.test.ts` in
  `test/js/bun/shell/` and `test/js/bun/shell/commands/`.
- Bun and its tests are MIT licensed (portions of `bunshell.test.ts` are derived
  from [deno_task_shell](https://github.com/denoland/deno_task_shell), also MIT).
  This corpus does not copy the test code. It records the scripts and the
  expected observable behaviour (stdout, stderr, exit codes, files, error
  messages), adapted into a data format.
- Oracle: the expectations were validated against the real `Bun.$` in
  **Bun 1.4.2** on Linux. Where Bun 1.4.2 behaves differently from the pinned
  upstream expectation, the corpus records what Bun actually does and explains the
  difference in a `note`.

## Layout

| File                    | Purpose                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cases/<name>.json`     | One file per upstream test file (`commands/echo.test.ts` becomes `cases/commands-echo.json`).                                                      |
| `corpus.mjs`            | Dependency-free helpers (Node >= 20 or Bun): `loadCorpus()`, `allCases()`, `setupFiles()`, `materialize()`, `checkExpectations()`, `skipReason()`. |
| `run-bun-reference.mjs` | Runs every case with the real `Bun.$` and prints PASS/FAIL/SKIP.                                                                                   |
| `inventory.mjs`         | Re-scans the upstream tests for test sites and checks that every site has exactly one unit in the corpus, with no stale units.                     |

## Schema

```jsonc
{
  "source": "test/js/bun/shell/commands/echo.test.ts",
  "units": [
    {
      "line": 12, // 1-based line of the upstream test( / it( / .runAsTest( site
      "upstream": "echo basic", // upstream test name or short description
      "disposition": "case", // "case" | "js-api" | "inapplicable"
      "cases": [/* CASE */],
      "api": "...", // js-api: the exact JS-surface assertions a hand-written test must make
      "reason": "...", // inapplicable: why (Bun-runtime internals only: RSS, GC, workers, ...)
      "note": "...", // optional: upstream todo/failing, Bun 1.4.2 differences, ...
    },
  ],
  "nonUnitSites": [{ "line": 124, "reason": "commented-out test" }], // regex hits that are not tests
}
```

A unit is every static `test(` / `it(` registration (including `test.skipIf`,
`test.todo`, `it.each`, and so on) and every TestBuilder `.runAsTest(` call. A
unit site that generates several tests (loops, `.each`) has one case per
generated test.

A CASE (all fields optional except `id`, `template` and `expect`):

| Field         | Meaning                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Unique, stable id, `<casefile>/<slug>`.                                                                                                                  |
| `template`    | The **raw** template strings (`TemplateStringsArray.raw`). A backslash-n in the source stays a backslash followed by `n`.                                |
| `values`      | Interpolated values, `template.length - 1` of them (see VALUE).                                                                                          |
| `files`       | `{ "rel/path": TEXT \| {"content": TEXT, "mode": "755"} \| {"symlink": "target"} }`, created in a fresh temp dir. Parent dirs are created automatically. |
| `dirs`        | Directories to create.                                                                                                                                   |
| `cwd`         | Working directory relative to the temp dir (default: the temp dir).                                                                                      |
| `env`         | Environment overrides merged over the process env. With `"envReplace": true` the env contains only these entries (upstream `.env({...})` semantics).     |
| `setup`       | `[{template, values}]` shell commands run first, in the same dir and env. They run in nothrow mode and their results are ignored.                        |
| `throws`      | `false` (default): nothrow semantics. `true`: Bun's default throwing mode, where a non-zero exit becomes a `ShellError`.                                 |
| `quiet`       | Informational. Runners always capture output.                                                                                                            |
| `timeoutMs`   | Per-case timeout (default 10 s).                                                                                                                         |
| `expect`      | See below.                                                                                                                                               |
| `platforms`   | `["posix"]`, `["windows"]`, `["linux"]` or `["darwin"]`: only run there.                                                                                 |
| `requires`    | External executables needed besides shell builtins (`node` is always provided through `{{NODE}}`).                                                       |
| `languages`   | `["js"]` only when a JS-only value type is used (`response`, `blob`, `jsfile`).                                                                          |
| `note`        | Free text.                                                                                                                                               |
| `oracleFlaky` | Reason text: the reference runner retries this case because of a known intermittent Bun 1.4.2 bug. Implementations must pass it on the first try.        |

`expect`:

- `stdout`, `stderr`: an EXPECT. An omitted field must be `""`, unless
  `expect.error` is set, in which case it is not checked.
- `exitCode`: a number, `{"not": n}`, `{"oneOf": [..]}` or `{"any": true}`.
  If omitted, it must be `0` (unchecked when `expect.error` is set).
- `error`: `true`, a substring of the thrown error message, or an EXPECT. The
  error must be thrown, either while parsing or as a rejected `ShellError` when
  `throws: true`. With `error`, `stdout`/`stderr`/`exitCode` are checked against
  the error's fields only when given.
- `files` (`{path: EXPECT}`), `exists`, `absent`, `types` (`{path: "file"|"dir"|"symlink"}`).
- `buffers`: `{id: EXPECT}`. This is the content of an `outBuffer` value with
  trailing NUL bytes stripped.

TEXT: `"string"`, `{"repeat": TEXT, "count": N}`, `{"concat": [TEXT...]}` or
`{"seq": [from, to]}` (integer lines, each followed by `\n`).

EXPECT: TEXT (exact match), `{"contains": s|[s]}`, `{"notContains": s|[s]}`,
`{"regex": "...", "flags": "s"}`, `{"startsWith": TEXT, "endsWith"?: TEXT, "length"?: N}`,
`{"endsWith": TEXT}`, `{"length": N}`, `{"sortedLines": [...]}` (non-empty
lines, compared after sorting), `{"lineCount": N}`, `{"any": true}`,
`{"allOf": [...]}` or `{"oneOf": [...]}`.

VALUE: `{"string": TEXT, "repeat"?: N}`, `{"number": 1}`, `{"bigint": "123"}`,
`{"bool": true}`, `{"null": true}`, `{"undefined": true}`, `{"raw": "..."}`
(Bun's `{raw}` object), `{"array": [VALUE...]}`, `{"bytes": "text"}` (a byte
buffer, for example `< ${buf}`), `{"outBuffer": {"id": "b1", "size": 100}}`
(a zeroed buffer used as the target of `> ${buf}`), `{"response": "body"}`,
`{"blob": "body"}`, `{"jsfile": "rel/path"}` (`Bun.file`, JS only) and
`{"path": "rel/path"}` (a string holding the absolute path of a temp-dir file).

### Placeholders

These can appear in templates, string values, env values, file contents and
expectations:

- `{{TEMP}}`: the absolute temp dir, with forward slashes.
- `{{NODE}}`: the absolute path of a Node-compatible JS runtime. Upstream uses
  `bun -e`/`bunExe()`; the corpus rewrites those scripts to plain node-compatible
  `-e`/`-p` code.
- `{{SEP}}`: the platform path separator.

## Running

```sh
# Validate the corpus against the real Bun.$ (the oracle)
bun conformance/bun-shell/run-bun-reference.mjs [--filter id-substring] [--file commands-echo] [--concurrency 8] [--verbose]

# Check completeness against an upstream bun checkout
node conformance/bun-shell/inventory.mjs --bun-root /path/to/bun [--table]
```

Implementations (JS, Rust, ...) load `cases/*.json` and do the following for
each case:

1. Create a temp dir and run `setupFiles`.
2. Build the template and values (`materialize`).
3. Run the script with the given cwd and env, in nothrow mode unless `throws` is set.
4. Compare the result with `checkExpectations`.

Reference result (Bun 1.4.2, Linux x64): `Total 1256: 1216 passed, 0 failed,
40 skipped` in about 6 s. The skipped cases are Windows-only, or they need
a non-root user or a missing tool (see each case's `platforms`/`requires`).

`js-api` units are not executable data. They describe JS-surface behaviour that
needs a hand-written test in each language binding.

## Units per upstream file

<!-- generated by: node inventory.mjs --bun-root /tmp/upstream/bun --table -->

| Upstream file                         |   Units |    case | js-api | inapplicable |    Cases |
| ------------------------------------- | ------: | ------: | -----: | -----------: | -------: |
| `assignments-in-pipeline.test.ts`     |      38 |      38 |      0 |            0 |       38 |
| `brace.test.ts`                       |      23 |       6 |     17 |            0 |       59 |
| `bunshell-default.test.ts`            |       2 |       2 |      0 |            0 |        2 |
| `bunshell-file.test.ts`               |       1 |       1 |      0 |            0 |        2 |
| `bunshell-instance.test.ts`           |      12 |       3 |      9 |            0 |       20 |
| `bunshell.test.ts`                    |     450 |     424 |     23 |            3 |      547 |
| `commands/basename.test.ts`           |      10 |      10 |      0 |            0 |       10 |
| `commands/cp.test.ts`                 |      16 |      16 |      0 |            0 |       32 |
| `commands/dirname.test.ts`            |      10 |      10 |      0 |            0 |       10 |
| `commands/echo.test.ts`               |      22 |      22 |      0 |            0 |       22 |
| `commands/exit.test.ts`               |       5 |       5 |      0 |            0 |        7 |
| `commands/false.test.ts`              |       4 |       4 |      0 |            0 |        4 |
| `commands/ls.test.ts`                 |      32 |      32 |      0 |            0 |       51 |
| `commands/mkdir.test.ts`              |       1 |       1 |      0 |            0 |       13 |
| `commands/mv.test.ts`                 |      13 |      13 |      0 |            0 |       14 |
| `commands/rm.test.ts`                 |       9 |       9 |      0 |            0 |       27 |
| `commands/seq.test.ts`                |      32 |      32 |      0 |            0 |       33 |
| `commands/touch.test.ts`              |       1 |       1 |      0 |            0 |        9 |
| `commands/true.test.ts`               |       4 |       4 |      0 |            0 |        4 |
| `commands/which.test.ts`              |       5 |       5 |      0 |            0 |        8 |
| `commands/yes.test.ts`                |       4 |       4 |      0 |            0 |        4 |
| `env.positionals.test.ts`             |       5 |       0 |      5 |            0 |        3 |
| `epipe.test.ts`                       |       2 |       1 |      1 |            0 |        2 |
| `exec.test.ts`                        |       9 |       7 |      0 |            2 |       17 |
| `file-io.test.ts`                     |      27 |      27 |      0 |            0 |       29 |
| `lazy.test.ts`                        |       1 |       0 |      1 |            0 |        1 |
| `leak.test.ts`                        |       5 |       4 |      1 |            0 |       44 |
| `lex.test.ts`                         |      31 |      31 |      0 |            0 |       80 |
| `parse.test.ts`                       |      22 |      22 |      0 |            0 |       35 |
| `pipeline_stack.test.ts`              |      63 |      63 |      0 |            0 |       63 |
| `shell-blocking-pipe.test.ts`         |       2 |       2 |      0 |            0 |        4 |
| `shell-cmdsub-crash.test.ts`          |       1 |       1 |      0 |            0 |        3 |
| `shell-hang.test.ts`                  |       2 |       2 |      0 |            0 |        7 |
| `shell-leak-args.test.ts`             |       3 |       2 |      1 |            0 |        3 |
| `shell-load.test.ts`                  |       1 |       1 |      0 |            0 |        3 |
| `shell-pipe-read-fault.test.ts`       |      11 |      11 |      0 |            0 |       13 |
| `shell-sentinel-hardening.test.ts`    |       3 |       3 |      0 |            0 |        3 |
| `shell-seq-condexpr.test.ts`          |       5 |       5 |      0 |            0 |        5 |
| `shell-worker-terminate-leak.test.ts` |       7 |       7 |      0 |            0 |        7 |
| `shell-write-fault.test.ts`           |       1 |       1 |      0 |            0 |        1 |
| `shelloutput.test.ts`                 |       3 |       0 |      3 |            0 |        6 |
| `throw.test.ts`                       |       4 |       0 |      4 |            0 |        4 |
| `yield.test.ts`                       |       4 |       4 |      0 |            0 |        7 |
| **Total**                             | **906** | **836** | **65** |        **5** | **1256** |
