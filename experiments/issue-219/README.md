# Deno CDN import regression

Reproduce the published package failure with Deno 2.9.6:

```bash
deno run -A --no-lock experiments/issue-219/cdn-import.mjs
```

The import fails before executing a command because esm.sh replaces
`require.resolve('shelljs')` with the bare specifier. ShellJS initialization
passes it to `createRequire`, which requires an absolute filesystem path or file
URL. Fixing that call also exposes the main entry's eager
`createRequire(import.meta.url)`: HTTP module URLs are invalid bases too.

Check the current checkout without publishing it to npm:

```bash
(cd js && bun install --frozen-lockfile)
bun test js/tests/shelljs-cdn.test.mjs --timeout 10000
node js/scripts/test-deno-cdn.mjs
```

The script bundles local modules with esbuild, serves the result over HTTP and
loads external dependencies from esm.sh. Its CommonJS shim reproduces esm.sh's
bare `require.resolve` and static `require` imports while using Deno's real
`createRequire`. The probe checks the public `$` export, `echo hi`, ShellJS
object identity, normal brace globs and rejection of a finite 101-level glob.
Both the original ShellJS loader and the independently restored eager main
loader fail this probe. The fixed checkout passes it.

CI also imports the immutable PR head through esm.sh's GitHub registry, with
the entry point's dependency versions from the package manifest. Only imported
dependencies are pinned: globally pinning the unused Execa 10 adapter would
replace ShellJS's Execa 5 dependency and break its transitive imports. This
verifies the real CDN compiler before release; the local HTTP probe covers the
fresh merge result.

The unit tests exercise bare specifiers and HTTP URLs without a network, and
verify that local installations still guard ShellJS's own fast-glob dependency
in an isolated dependency tree. The CI HTTP test gates automatic and manual
JavaScript releases and preserves its diagnostics as an artifact.

This tests current source with real CDN dependencies and a real CDN build.
Importing a newly published npm version through esm.sh can be checked by passing
its URL to the probe. Filesystem loaders for `$.zx` and Execa remain available in
local Node/Bun installs; they are initialized only when those APIs are used.
