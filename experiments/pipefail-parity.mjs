// Compares `set -o pipefail` behaviour between runtimes and against a real shell.
import { $, shell, register, unregister } from '../src/$.mjs';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const $q = $({ mirror: false, capture: true });

register('cat-virtual', async ({ stdin }) => ({ stdout: String(stdin ?? ''), code: 0 }));

const probe = async (label, fn) => {
  try {
    const r = await fn();
    console.log(`[${runtime}] ${label.padEnd(34)} -> code=${r.code} stdout=${JSON.stringify(r.stdout)}`);
  } catch (e) {
    console.log(`[${runtime}] ${label.padEnd(34)} -> THREW ${JSON.stringify(e.message)} code=${e.code}`);
  }
};

shell.pipefail(true);
await probe('system | system', () => $q`sh -c 'exit 3' | cat`);
await probe('system | built-in', () => $q`sh -c 'echo x; exit 3' | cat`);
await probe('system | virtual', () => $q`sh -c 'echo x; exit 3' | cat-virtual`);
await probe('built-in | system', () => $q`echo x | sh -c 'exit 4'`);
shell.pipefail(false);
await probe('no pipefail: system | system', () => $q`sh -c 'exit 3' | cat`);

const real = await $q`sh -c 'set -o pipefail; sh -c "exit 3" | cat; echo code=$?'`;
console.log(`[${runtime}] real shell with pipefail        -> ${JSON.stringify(real.stdout)}`);

unregister('cat-virtual');
