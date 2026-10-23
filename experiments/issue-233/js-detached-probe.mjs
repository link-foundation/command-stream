// Probe for issue #232: detach a delayed write, print the pid and exit at once.
// Usage: bun|node js-detached-probe.mjs <dir>
import { $, spawnDetached } from '../../js/src/$.mjs';

const dir = process.argv[2];
const mode = process.argv[3] ?? 'function';
const started = Date.now();
const { pid } =
  mode === 'tag'
    ? await $({ cwd: dir, detached: true })`sleep 0.5; echo alive > alive`
    : await spawnDetached('sleep 0.5; echo alive > alive', { cwd: dir });
console.log(JSON.stringify({ pid, ms: Date.now() - started }));
