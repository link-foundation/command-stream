// Reproduces the `cd` into a path containing quotes and `$1`, which the
// built-in path has to unquote exactly like a shell would.
import { $ } from '../src/$.mjs';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const $q = $({ mirror: false, capture: true });
const base = mkdtempSync(join(tmpdir(), 'special-chars-'));
const specialDir = join(base, "test-'dir'-$1");

try {
  const mk = await $q`mkdir -p ${specialDir}`;
  console.log(`[${runtime}] mkdir code`, mk.code, JSON.stringify(mk.stderr));
  console.log(`[${runtime}] exists   `, existsSync(specialDir));
  const init = await $q`cd ${specialDir} && git init`;
  console.log(`[${runtime}] git init `, init.code, JSON.stringify(init.stderr));
  const status = await $q`cd ${specialDir} && git status`;
  console.log(`[${runtime}] git statu`, status.code, JSON.stringify(status.stderr));
} finally {
  rmSync(base, { recursive: true, force: true });
}
