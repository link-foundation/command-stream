// Generates js/src/bun-shell/errno-linux.mjs: Linux errno numbers by code
// name. Bun uses Linux numbering on Windows too (its Windows `E` enum starts
// with Linux's), so the port needs them where Node reports libuv codes.
// Run on Linux.
import fs from 'node:fs';
import os from 'node:os';

if (process.platform !== 'linux') {
  throw new Error('run on Linux');
}
const rows = Object.entries(os.constants.errno)
  .sort((a, b) => a[1] - b[1])
  .map(([k, v]) => `  ${k}: ${v},`)
  .join('\n');
fs.writeFileSync(
  'js/src/bun-shell/errno-linux.mjs',
  `// Linux errno numbers by code name, generated from Node.js on Linux by
// experiments/issue-27/gen-errno-linux.mjs. Do not edit by hand.

export const LINUX_ERRNO = {
${rows}
};
`
);
