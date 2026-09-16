// Probes `echo ... > file` redirection with built-in commands.
import { $ } from '../src/$.mjs';
const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const $q = $({ mirror: false, capture: true });
const dir = `/tmp/redirect-probe-${runtime}`;
await $q`rm -rf ${dir}`;
await $q`mkdir -p ${dir}`;
const f = `${dir}/out.txt`;
const w = await $q`echo "test content" > ${f}`;
console.log(`[${runtime}] write code=${w.code} stdout=${JSON.stringify(w.stdout)} stderr=${JSON.stringify(w.stderr)}`);
const r = await $q`cat ${f}`;
console.log(`[${runtime}] read  code=${r.code} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);
await $q`rm -rf ${dir}`;
