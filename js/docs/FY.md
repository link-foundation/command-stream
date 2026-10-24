# Translate source with `$fy`

The JavaScript and Rust CLIs share the same source options and output format.

```sh
npm install use-m
npx command-stream fy deploy.sh deploy.mjs
node deploy.mjs staging
# With the Rust binary installed:
command-stream fy deploy.sh another-deploy.mjs
```

Shell output loads `command-stream` with `await use('command-stream')`. `use-m`
resolves the library; install `use-m` where Node can resolve it from the generated
file. The selected shell must also be available. `--no-use-m` imports an installed
`command-stream` directly. `--module NAME` selects another package or local module.

The default shell translation retains the entire source as a literal argument to
`command(...).run()`. Functions, loops, case globs, heredocs, quoting, positional
arguments, stdin, environment, and exit status keep their interpreter behavior.
The interpreter comes from the first-line sh/bash/dash/zsh shebang, or defaults
to sh. Override it with `--shell bash` or `--from bash`.

```sh
printf 'echo hello\n' | command-stream fy - hello.mjs
command-stream fy --no-use-m --no-shebang deploy.sh deploy-installed.mjs
command-stream fy --structural deploy.sh statements.mjs
```

`--structural` compiles the supported shell subset to JavaScript statements,
including assignments, expansions, control flow, functions, pipelines, redirects,
and short-circuit operators. It reports unhandled constructs on stderr. The
default interpreter translation is appropriate when exact shell semantics matter.
Output files are created exclusively, with executable permissions on Unix;
existing files are never overwritten. With no output filename, code goes to
stdout and diagnostics go to stderr. `--` ends option parsing.

## Migrate competitor JavaScript

```sh
command-stream fy old-zx.mjs migrated.mjs
command-stream fy --from shelljs legacy.cjs migrated-shelljs.mjs
printf 'import { execa } from "execa";' | command-stream fy --from execa
```

`.js`, `.mjs`, and `.cjs` filenames select JavaScript automatically. Use
`--from javascript`, `zx`, `execa`, `shelljs`, `cross-spawn`, or `bun` for stdin.
Source is parsed as JavaScript; syntax nodes select module references, and
substitution rules emit these matching compatibility entry points:

| Source module                           | Generated module                                |
| --------------------------------------- | ----------------------------------------------- |
| `zx`, `zx/core`, `zx/globals`, `zx/cli` | `command-stream/zx`, with the same subpath      |
| `execa`                                 | `command-stream/execa`                          |
| `shelljs`, `shelljs/plugin`             | `command-stream/shelljs`, with the same subpath |
| `cross-spawn`                           | `command-stream/cross-spawn`                    |
| `bun` (Bun shell API)                   | `command-stream/bun`                            |

Static imports, re-exports, literal dynamic imports, and literal `require` calls
are recognized, including imports inside template expressions and escaped module
names. Comments, ordinary strings, regexes, property methods, and surrounding
source layout are preserved. Unsupported competitor subpaths are retained with
a diagnostic. If the source binds its own `require`, calls to that identifier are
conservatively retained with a diagnostic; imports still migrate. Computed module
names need a literal reference to migrate automatically.

`.cjs` or `--commonjs` wraps migrated CommonJS in an ES module with Node's
`createRequire`, `module`, `exports`, `__filename`, and `__dirname`; its exports
become the default export. Keep the output beside the input when relative imports
or paths depend on that location. Compatibility entry points retain the source
API, including its runtime and platform requirements; Bun migration targets the
Bun shell API rather than Bun's unrelated runtime APIs.

## Library APIs and translation rules

```js
import { translateSource } from 'command-stream/fy';

const { code, diagnostics, network, ruleSet } = translateSource(
  'import { $ } from "zx";',
  { from: 'zx' }
);
console.log(code, diagnostics, network, ruleSet);
```

Rust exposes `fy::{translate_source, SourceOptions}` and the dedicated
`translate_shell_program`, `translate_competitor_source`, and
`translate_shell_to_mjs` functions. The existing root `fy(source)` helper remains
available for an interpreter-backed module importing command-stream directly.

Source front ends formalize tokens and syntax into `meta-language::LinkNetwork`
(`LinkNetwork` in JavaScript). `LinkQuery` selects source terms and
`TranslationRuleSet` templates substitute captured references. Shell program
rules capture the original source and execution parameters; structural rules
render individual shell constructs; migration rules render module references
and preserve source spans. A shared renderer supports recursive captures,
language modes, separators, conditional sections, and indentation. Byte-preserving
migration disables indentation of original source spans.

Shared fixtures under `fixtures/fy/` verify JavaScript/Rust output parity.
`js/tests/fy-migration.test.mjs` executes migrated scripts through the supported
APIs in available Node and Bun runtimes, compares shell execution, exercises the
real `use-m` loader, and checks both CLI entry points. Rust tests exercise the
same fixtures, native CLI, virtual command, parser safety, and output protection.

[Upstream integration findings](meta-language-gaps.md) document the versions,
the existing upstream report, resolved Rust gaps, and remaining local evaluator
features. The design follows meta-language's formalize-then-substitute model;
relative-meta-logic's separation of representation from evaluation and formal-ai's
rule composition inform that separation without adding runtime dependencies.
