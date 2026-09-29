---
'command-stream': minor
---

Add a zx-compatible API (issue #26): `command-stream/zx`, `command-stream/zx/core`, `command-stream/zx/globals` and `command-stream/zx/cli` (ESM and CommonJS, with TypeScript types), `$.zx` on the main `$`, and a `command-stream` executable that runs zx scripts, including ones starting with `#!/usr/bin/env command-stream`. All 291 units of zx's test suite are ported and run on Node.js and Bun. See `docs/ZX_MIGRATION.md`.

Share project-local executable lookup with the default `$`, `run()`, and Bun Shell APIs through the `preferLocal` option.
