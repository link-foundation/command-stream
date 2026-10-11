# ShellJS compatibility source

This directory retains ShellJS 0.10.0's command implementation from the npm
tarball. The BSD-3-Clause license is included in `LICENSE`. The local package
manifest sets CommonJS parsing and declares no dependencies.

Two imports differ from upstream:

- `src/common.js` and `src/ls.js` use `../../glob.cjs`, which adapts the existing
  dependency-free command-stream glob implementation and applies input limits.
- `src/cmd.js` uses `../../runtime.cjs` to call the already installed Execa
  runtime's `execaSync` export instead of installing a second, older Execa tree.

`shell.js`, the remaining commands and the plugin registration helpers retain
their upstream source. Consumer entry points share this local implementation;
a separately installed upstream ShellJS package has its own state.
The ESM entry supplies the glob and Execa imports to the CommonJS commands, so
ESM consumers on Node 22.0 do not require the newer `require(esm)` bridge.

The matching `@types/shelljs` 0.10.0 declarations are bundled at
`types/shelljs-upstream.d.cts` under the included MIT license. Their glob options
refer to bundled declarations rather than importing fast-glob. Helper signature
corrections remain in `types/shelljs.d.cts`.

To reproduce the source import after installing the pinned development packages:

```sh
node experiments/issue-221/vendor-shelljs.mjs
js/node_modules/.bin/prettier --write js/types/shelljs-upstream.d.cts
```

Run `node experiments/issue-221/glob-parity.mjs` for the configuration and syntax
comparison with the pinned upstream engine. Production consumers install neither
ShellJS nor its type package, fast-glob, micromatch or braces through this boundary.
