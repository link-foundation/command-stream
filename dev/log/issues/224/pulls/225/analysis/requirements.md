# Requirements and design for issue 224 / PR 225

The parent issue and every child issue and comment were read on 2026-10-11.
At initial research there were no images or PR review comments. Issue 1 has only a title; issue 9
has one comment permitting reuse of telegram-terminal-bot code. None of the
six requests is completely resolved in the current codebase.

## Scope and acceptance matrix

| Issue | Every requested deliverable | Existing behavior | Alternatives and implementation plan | Verification |
| --- | --- | --- | --- | --- |
| 224 | Read all six issues and comments; deliver one PR without follow-up deferrals; close parent and all children with separate keywords; identify already resolved behavior | Draft PR 225 exists | Extend that PR and retain all seven closing lines. Audit JS ESM/CJS/lightweight/types, Rust library/CLI and documentation | Review final PR diff, description, clean branch and latest-SHA CI |
| 1 | `$fy` shell-to-mjs translator | No translator | An AST compiler (mvdan/sh, tree-sitter-bash) would need to reimplement shell expansion, subshells and control flow. Generate an executable ES module using command-stream's exact-argv builder and embed the complete shell program as data instead. Preserve arguments, stdin, environment, working directory, control flow, pipelines, heredocs and exit status. Provide API and `$fy`/`command-stream fy` CLI; explicitly describe interpreter-backed translation | Execute generated modules and compare with shell execution, including hostile JS-template characters and arguments |
| 9 | Virtual terminal buffer; frame change events/stream analogous to requestAnimationFrame; reusable by telegram bot; convert output to text on demand with optional color | PTY capture and frame snapshots already use xterm/headless and vt100; no independent writable buffer API | Reuse these emulators rather than copy a separate implementation. Expose write/resize/snapshot/text/frame subscription, coalesce changes, suppress identical frames, release resources | Cursor rewrites, color, split UTF-8/escape sequences, alternate screen, resize and change events |
| 30 | Command packages; composition; inheritance; async-generator streams; middleware/plugins; type-safe interfaces; hot reload; install/create/extend; marketplace search; git helpers/deploy/ls color examples | Registration, builtins and raw async generators exist. Generator detection uses constructor name and fails for wrapped generators | Reuse registry with validated atomic package installation, middleware preserving iterable handlers, inherited aliases and composition, package metadata/exports contract, npm resolution/install and registry search, reload using fresh imports and watch integration. Bundle runnable package examples including git/deploy/ls middleware. Keep `create(options)` compatibility while adding `$.create(name, handler)` | Fixture packages, generator middleware, rollback on invalid package, search with mocked registry, live reload and declarations |
| 31 | `stream().analyze`; map/filter/reduce; split; merge; sliding windows/batching; backpressure; live error-rate/response-time/throughput; filter/map/batch/forEach pipeline; memory-efficient live monitoring/alerts; examples and buffered comparison | Raw event/chunk iterator exists, with an unbounded JS queue; Rust already uses bounded Tokio channels | Build pull-driven async-iterable operators, line framing explicit through `.lines()`, awaited callbacks, bounded split/merge, incremental statistics with callback updates, byte/chunk-limited process queues and upstream pumping waits. Preserve existing stdout/stderr/exit chunks. Existing Node streams and RxJS are options; native async iterators avoid a second stream model or dependency | Chunk boundaries, UTF-8, async operators, partial batches/windows, split fairness/cancellation, merge errors, slow consumers, online metrics and finite memory experiment |
| 32 | `$.dev({watch,repl})` restart; CLI shell REPL with JS `$`, registration, bare commands, completion; visual pipeline debugger with stepping/data inspection/flow; hot reload/visualization/profiling/memory/timeline; VSCode syntax/command completion/docs/errors; built-in test utilities/mocks/pipeline assertions/snapshots | Tracing exists, zx CLI executes scripts, no dev/REPL/debugger/test kit/extension | Node built-in REPL and file watching, process restart with awaited shutdown/debounce, debugger over named async-iterable stages with explicit step gates and bounded previews plus duration/memory/timeline, a VSCode extension using TextMate injection and completion/hover/diagnostics, scoped mock registry restoration and snapshot files. Retain zx CLI behavior | Noninteractive REPL input, watch fixtures, debugger stepping and errors, scoped mocks/snapshot mismatches, extension providers with mocked VSCode and visual artifact |
| 34 | `$.command(file,...args).pipe($.command.stdout('inherit'),$.command.exitCode).run()`; fluent builder; runnable string; immediate execution; avoid quoting/injection problems; Effect/Rust command style | Exact argv runner already exists in JS; Rust StreamingRunner has from_argv | Immutable lazy command specification with option transforms and result selectors, exact-argv execution, `toString()` rendering for POSIX shells, await/run/stream entry points. Rust wraps Tokio/std command rather than introducing another shell parser | No early execution; shell metacharacters/empty args/newlines/quotes stay literal; env/cwd/stdin/stdout and exit-code selection; repeated execution and string roundtrip |

## Goals versus deliverables

The checkboxes and API examples above are deliverables. Issue 30 additionally
names 10+ published packages, developer adoption and enterprise showcases;
issue 31 asks for examples, measured buffered comparisons and monitoring use
cases; issue 32 names extension downloads, REPL feedback and test-kit adoption.
Examples and measured comparisons can be delivered here. Downloads, adoption,
feedback and third-party publication are outcomes after release, not evidence
that can truthfully be fabricated in a PR. Ship ten installable example
packages with a documented publication contract and enterprise workflow; the
repository's existing release workflows publish the updated library on merge.

## Primary-source research and existing components

- [Effect Command](https://effect.website/docs/v3/platform/command) uses lazy
  command descriptions and executor-selected outputs. Adopt lazy construction
  and option transforms; avoid adding Effect's execution runtime.
- [Rust std::process::Command](https://doc.rust-lang.org/std/process/struct.Command.html)
  accepts program and arguments separately. Its shell-free argument behavior
  is the builder's correctness criterion; rendered strings target POSIX shells.
- [xterm.js](https://github.com/xtermjs/xterm.js) provides headless emulation;
  [serialize addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-serialize)
  can restore terminal state. The repo already depends on headless; reuse its
  public buffer API and existing frame/color extraction rather than add an addon.
- [telegram-terminal-bot](https://github.com/konard/telegram-terminal-bot) is
  the requested integration context. Existing emulator snapshots cover the
  same terminal-to-text need without copying unrelated bot transport code.
- [Node stream API](https://nodejs.org/api/stream.html) supports async iterators
  and bounded buffering. [RxJS](https://rxjs.dev/guide/observable) uses a push
  model; adding it would still require adapting process backpressure. Native
  pull operators fit the current API and await slow downstream callbacks.
- [npm registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md)
  provides package metadata/search. Use npm package resolution/install (the existing Execa runtime handles npm shims on Windows) and its
  search endpoint rather than invent a hosted marketplace service.
- [Node REPL](https://nodejs.org/api/repl.html) supplies persistent context,
  editing and completion. [Node fs](https://nodejs.org/api/fs.html) supplies
  watch/glob primitives. [Chokidar](https://github.com/paulmillr/chokidar) is an
  alternative when platform watch normalization is needed; current releases
  removed glob support, so glob expansion is needed with either approach.
- [VSCode language API](https://code.visualstudio.com/api/language-extensions/programmatic-language-features)
  supplies completion, hover and diagnostics;
  [syntax injections](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide)
  can highlight shell template strings without replacing JavaScript support.
- [mvdan/sh](https://github.com/mvdan/sh) is a mature shell parser/interpreter
  but is Go-based. Use actual shell execution for semantic fidelity; a full
  shell-to-native-JavaScript compiler is not assumed by the title-only request.

## Cross-codebase and resource strategy

Keep the existing compatibility entry points intact. Expose core builder and
stream APIs from the lightweight ProcessRunner path; add equivalent Rust
portable features and native CLI tooling. JavaScript module packages and a
VSCode JavaScript extension are inherently language-specific. Tests exercise
Node and Bun and CJS forwarding as well as Rust equivalents. No default-on
debug logging. Preserve existing tracing and add component traces where needed.

Run focused tests before integration suites. Save large logs and read failures
in chunks no larger than 1500 lines. Rust builds use one job, no debug info and
finite test inputs within the 2.92 GiB container budget. Commit atomic features
after local checks, and perform the full CI timestamp/SHA/log protocol at the
end. Prepare minor releases with a JS changeset and Rust changelog fragment.

## Related implementation review

Recent merged PRs [223](https://github.com/link-foundation/command-stream/pull/223),
[220](https://github.com/link-foundation/command-stream/pull/220), and
[211](https://github.com/link-foundation/command-stream/pull/211) establish the
packaging, optional PTY, and stream-cancellation compatibility boundaries.
This change keeps the bundled ShellJS and shared CJS/ESM state, leaves PTY optional,
keeps lightweight imports independent of terminal assets, and retains subscribing
before startup plus exactly one exit chunk for pre-aborted commands. The raw
stream iterator regression suite covers those earlier fixes. Native pipelines
now share a pull-driven pump instead of eager tees or Node intermediate captures.
