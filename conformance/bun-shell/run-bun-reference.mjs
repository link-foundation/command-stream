// Reference runner: validates the corpus against the real Bun.$ (the oracle).
//
//   bun conformance/bun-shell/run-bun-reference.mjs [--filter substr] [--file name]
//       [--concurrency N] [--node /path/to/node] [--verbose]
//
// Every case is executed in a fresh temp directory with Bun.$, using nothrow
// semantics unless the case sets "throws": true. Results are compared with
// checkExpectations() and a PASS/FAIL/SKIP line is printed per case.

import { runCorpus } from './runner.mjs';

if (!globalThis.Bun) {
  console.error('run-bun-reference.mjs must be executed with bun');
  process.exit(2);
}
const { $ } = await import('bun');

const counts = await runCorpus({
  $,
  label: `Bun ${Bun.version}`,
  which: (b) => !!Bun.which(b),
  defaultNode: Bun.which('node') || process.execPath,
  retryFlaky: true,
});
process.exit(counts.FAIL ? 1 : 0);
