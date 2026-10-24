# Lightweight shell entry point

For shell scripts and tools that need `$` without compatibility layers or
terminal features, use the supported core entry:

```javascript
import { $, ProcessRunner, register } from 'command-stream/core';

const result = await $({ mirror: false })`echo ${'hello core'}`;
console.log(result.stdout.toString());
```

CommonJS supports the same entry: `const $ = require('command-stream/core')`.
It exports `$`, `ProcessRunner`, quoting and shell settings, built-in virtual
commands, registration and composition, command builders and stream processing.
These share implementation and state with `command-stream` and
`command-stream/process-runner`, so importing both entries keeps registrations
and shell settings synchronized.

Core does not initialize ShellJS, Execa, zx, Bun Shell compatibility, terminal
capture/buffers, package installation, REPL, debugger or testing helpers. Use the
full `command-stream` entry or a dedicated compatibility subpath for those APIs.
This reduces startup work and avoids native terminal modules in bundles;
installed dependency size is unchanged.

CI enforces fewer than 100 non-builtin modules for a cold ESM import and CommonJS
require of core, and rejects compatibility or terminal modules in either graph.
Timing is reported without a machine-dependent limit. To compare on your machine
(Node.js 22.15+):

```bash
node experiments/issue-235/import-probe.mjs command-stream
node experiments/issue-235/import-probe.mjs command-stream/core
node experiments/issue-235/import-probe.mjs command-stream/core require
```
