// Order of chunks when piping `stdall` from an already-settled process.
import { $ } from '../js/src/zx/core.mjs';
const p = $`echo foo >&2; sleep 0.01 && echo bar`;
console.log('o1', JSON.stringify((await p.pipe.stderr`cat`).toString()));
console.log('store', JSON.stringify((await p).stdall));
console.log('o3', JSON.stringify((await p.pipe.stdall`cat`).toString()));
const q = $`echo foo >&2; sleep 0.01 && echo bar`;
console.log('fresh o3', JSON.stringify((await q.pipe.stdall`cat`).toString()));
const r = $`echo foo >&2; sleep 0.01 && echo bar`;
await r;
console.log(
  'settled o3',
  JSON.stringify((await r.pipe.stdall`cat`).toString())
);
