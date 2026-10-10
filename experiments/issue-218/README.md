# Issue #218: Linux installs without a build toolchain

`node-pty@1.1.0` has no `prebuilds/linux-x64` directory. The 2.0.0 manifest
requires it, so a clean Node slim container falls back to node-gyp and fails
without Python, make, and a compiler. The existing PTY host already loads the
binding only when a terminal is opened; marking its dependency optional lets
npm retain the core package after a failed native build.

Pack and test the current checkout from the repository root:

```bash
mkdir -p /tmp/command-stream-install
(cd js && npm pack --ignore-scripts --pack-destination /tmp/command-stream-install)
archive="$(find /tmp/command-stream-install -name '*.tgz' -print -quit)"
docker run --rm --memory=512m --cpus=2 \
  -v "$PWD:/repo:ro" -v "$archive:/package.tgz:ro" \
  node:22-bookworm-slim \
  bash /repo/js/scripts/test-production-install.sh /package.tgz scripts-enabled
```

Repeat with `scripts-disabled` and `omit-optional`, and with Node 24 and 26.
The script asserts that build tools are absent and tests both local and global
production installs. npm 12 gets an explicit node-pty script allowlist. It
exercises bare ESM and CommonJS exports, synchronous execution, the standalone
ProcessRunner path and literal arguments with spaces, then checks that opening
a PTY reports recovery instructions while the core APIs remain usable.

Before the fix, the enabled-scripts Node 22 install exits 1 during node-gyp.
After the fix, npm can report the optional native build failure while the
installation and core execution checks succeed. A separate regression test
isolates the real PTY host from node-pty and checks its missing-binding error:

```bash
bun test js/tests/optional-pty.test.mjs
```

The supported stable node-pty version stays in use. PTY consumers on Linux
still need a build toolchain; this fix makes native PTY installation optional
for consumers that only need process execution.
