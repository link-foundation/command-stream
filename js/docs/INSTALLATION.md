# Installation and optional PTY support

The core `$` API and `command-stream/process-runner` work without a native
build toolchain, including production installs with `--ignore-scripts` or
`--omit=optional`. ESM and CommonJS imports both support these installs.

```bash
npm install --omit=dev command-stream
npm install --omit=dev --ignore-scripts command-stream
npm install --omit=dev --omit=optional command-stream
```

`node-pty` is an optional dependency, loaded only when `captureTerminal()` or
`openTerminal()` opens a pseudoterminal. If its installation fails or optional
dependencies are omitted, ordinary process execution remains available. PTY
calls report installation instructions when the native binding is unavailable.

The stable `node-pty` release has no Linux prebuilds, so Linux PTY users need
Python, make, and a C/C++ compiler and must allow its lifecycle scripts. On
Debian or Ubuntu, install `python3` and `build-essential`, then run
`npm install node-pty` and `npm rebuild node-pty` in the consuming project.
For global installations, rebuild in the global prefix with
`npm rebuild --global node-pty` after installing the toolchain.

Bun users must trust `node-pty`'s install scripts. npm versions that enforce a
script allowlist also need to allow `node-pty`; ignoring scripts still supports
the core API but leaves PTY support unavailable if no usable prebuild exists.

CI installs the packed package locally and globally in Node 22, 24, and 26
slim containers without Python, make, or C/C++ compilers. Each runtime covers
enabled (explicitly allowlisted on npm 12), disabled, and omitted-optional
installs, with ESM `$`, CommonJS synchronous execution, the lightweight
ProcessRunner entry point, exact argv with spaces, and the public PTY error.
