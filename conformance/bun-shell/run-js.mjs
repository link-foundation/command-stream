// Runs the corpus against command-stream's portable Bun Shell port
// (js/src/bun-shell), on Node.js, Bun or Deno:
//
//   node conformance/bun-shell/run-js.mjs [--filter substr] [--file name]
//       [--concurrency N] [--node /path/to/node] [--verbose]
//   bun conformance/bun-shell/run-js.mjs ...
//   deno run -A conformance/bun-shell/run-js.mjs ...

import { which } from '../../js/src/bun-shell/builtin.mjs';
import { $ } from '../../js/src/bun-shell/shell.mjs';
import { runCorpus } from './runner.mjs';

const onPath = (bin) => which(process.env.PATH ?? '', process.cwd(), bin);
const runtime = globalThis.Bun
  ? `Bun ${globalThis.Bun.version}`
  : globalThis.Deno
    ? `Deno ${globalThis.Deno.version.deno}`
    : `Node.js ${process.version}`;

const counts = await runCorpus({
  $,
  label: `command-stream bun-shell (JS) on ${runtime}`,
  which: (b) => onPath(b) !== null,
  defaultNode: onPath('node') ?? process.execPath,
  factory: { jsfile: (absPath) => $.file(absPath) },
});
process.exit(counts.FAIL ? 1 : 0);
