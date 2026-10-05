import { $ } from '../src/$.mjs';

// 1. Large output - no truncation
const big = await $({
  mirror: false,
})`sh -c 'for i in $(seq 1 5000); do echo "line $i"; done'`;
const lines = big.stdout.trim().split('\n');
console.log(
  'large output lines:',
  lines.length,
  'last:',
  lines[lines.length - 1],
  'code:',
  big.code
);

// 2. exit code non-zero
const r = await $({ mirror: false })`sh -c 'exit 42'`.catch((e) => e);
console.log('exit code 42:', r.code);

// 3. stderr capture
const e = await $({ mirror: false })`sh -c 'echo to-err 1>&2'`;
console.log('stderr:', JSON.stringify(e.stderr.trim()));

// 4. timing for normal fast command (should be fast, not +100ms)
const t = Date.now();
await $({ mirror: false })`echo quick`;
console.log('fast command elapsed:', Date.now() - t, 'ms');
