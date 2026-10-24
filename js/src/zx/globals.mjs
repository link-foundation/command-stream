// `import 'command-stream/zx/globals'` exposes `$`, `cd`, `fs`, `glob`, ...
// as globals, like `zx/globals` (issue #26).

import * as zx from './index.mjs';

Object.assign(globalThis, zx);
