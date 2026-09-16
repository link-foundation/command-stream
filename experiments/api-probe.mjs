// Probe of command-stream API behaviours used by the comparison examples.
// Run with:  node experiments/api-probe.mjs   and   bun experiments/api-probe.mjs
import {
  $, sh, exec, run, create, quote, raw,
  register, unregister, listCommands,
  shell, set, unset,
  AnsiUtils, getAnsiConfig
} from '../src/$.mjs';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const out = (k, v) => console.log(`[${runtime}] ${k}:`, JSON.stringify(v));

const $q = $({ mirror: false, capture: true });

out('basic', (await $q`echo hi`).stdout);
out('exitcode', (await $q`sh -c 'exit 3'`).code);
out('sync', $({ mirror: false })`echo sync`.sync().stdout);
out('text', await (await $q`echo text`).text());
out('pipe-shell', (await $q`echo hello | tr a-z A-Z`).stdout);

register('upper', async ({ stdin }) => ({ stdout: String(stdin || '').toUpperCase(), code: 0 }));
out('virtual', (await $q`echo abc | upper`).stdout);
out('pipe-method', (await $({ mirror: false })`echo pm`.pipe($({ mirror: false })`upper`)).stdout);
unregister('upper');

register('gen', async function* ({ args }) {
  for (let i = 1; i <= Number(args[0] || 2); i++) yield `n${i}\n`;
});
out('virtual-stream', (await $q`gen 3`).stdout);
unregister('gen');

out('builtins-count', listCommands().length);
out('quote', quote("it's a test"));
out('raw', raw('*'));
out('opts-env', (await $({ mirror: false, env: { ...process.env, PROBE: 'yes' } })`printenv PROBE`).stdout);
out('opts-cwd', (await $({ mirror: false, cwd: '/tmp' })`pwd`).stdout);
out('opts-stdin', (await $({ mirror: false, stdin: 'from-stdin\n' })`cat`).stdout);

const buf = await $({ mirror: false })`echo buf`.buffers.stdout;
out('buffers', [Buffer.isBuffer(buf), buf.length]);
const str = await $({ mirror: false })`echo str`.strings.stdout;
out('strings', str);

const chunks = [];
for await (const chunk of $({ mirror: false })`seq 1 3`.stream()) {
  chunks.push([chunk.type, chunk.data.toString()]);
}
out('stream', chunks);

const ev = [];
await new Promise((resolve) => {
  $({ mirror: false })`sh -c 'echo o; echo e >&2'`
    .on('stdout', d => ev.push(['stdout', d.toString().trim()]))
    .on('stderr', d => ev.push(['stderr', d.toString().trim()]))
    .on('end', r => { ev.push(['end', r.code]); resolve(); })
    .start();
});
out('events', ev);

const g = $({ mirror: false })`cat`;
const stdinStream = await g.streams.stdin;
stdinStream.write('line1\n');
stdinStream.end();
out('streams-stdin', (await g).stdout);

shell.errexit(true);
try {
  await $q`sh -c 'exit 7'`;
  out('errexit', 'no-throw');
} catch (e) {
  out('errexit', ['threw', e.code]);
}
shell.errexit(false);

set('x');
const xOn = shell.settings().xtrace;
unset('x');
out('set-unset', `${xOn}/${shell.settings().xtrace}`);

out('ansi', AnsiUtils.stripAnsi(String.fromCharCode(27) + '[31mred' + String.fromCharCode(27) + '[0m'));
out('ansi-config', getAnsiConfig());
out('sh-fn', (await sh('echo shfn', { mirror: false, capture: true })).stdout);
out('run-fn', (await run('echo runfn')).stdout);
out('exec-fn', (await exec('echo', ['execfn'], { mirror: false, capture: true })).stdout);

const $c = create({ mirror: false, capture: true });
out('create-fn', (await $c`echo createfn`).stdout);

const k = $({ mirror: false })`sleep 5`;
k.start();
setTimeout(() => k.kill(), 200);
const kr = await k;
out('kill', kr.code);
