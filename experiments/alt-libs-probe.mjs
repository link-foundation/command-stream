import { $ as zx } from 'zx';
import { execa, execaSync, $ as execa$ } from 'execa';
import shelljs from 'shelljs';

const out = [];
const t = async (label, fn) => { try { out.push([label, 'ok', await fn()]); } catch (e) { out.push([label, 'ERR', e.message.split('\n')[0]]); } };

zx.verbose = false;
await t('zx stdout', async () => (await zx`echo hi`).stdout);
await t('zx sync', () => zx.sync`echo hi`.stdout);
await t('zx nothrow exitCode', async () => (await zx({ nothrow: true })`exit 3`).exitCode);
await t('zx pipe', async () => (await zx`echo hi`.pipe(zx`tr a-z A-Z`)).stdout);
await t('zx iterate', async () => { const lines=[]; for await (const l of zx`printf 'a\nb\n'`) lines.push(l); return lines; });
await t('zx stdin', async () => (await zx({ input: 'x' })`cat`).stdout);
await t('zx kill', async () => { const p = zx({nothrow:true})`sleep 5`; setTimeout(()=>p.kill(),50); return (await p).exitCode; });

await t('execa stdout', async () => (await execa`echo hi`).stdout);
await t('execa sync', () => execaSync`echo hi`.stdout);
await t('execa reject false', async () => (await execa({ reject: false })`sh -c 'exit 3'`).exitCode);
await t('execa pipe', async () => (await execa`echo hi`.pipe`tr a-z A-Z`).stdout);
await t('execa iterate', async () => { const lines=[]; for await (const l of execa`printf 'a\nb\n'`) lines.push(l); return lines; });
await t('execa input', async () => (await execa({ input: 'x' })`cat`).stdout);
await t('execa $ template', async () => (await execa$`echo hi`).stdout);

shelljs.config.silent = true;
await t('shelljs exec', () => { const r = shelljs.exec('echo hi'); return [r.stdout, r.code]; });
await t('shelljs async', () => new Promise(r => shelljs.exec('echo hi', { async: true }, (code, stdout) => r([code, stdout]))));
await t('shelljs ls', () => shelljs.ls('/tmp').length >= 0);
await t('shelljs pipe', () => shelljs.echo('hi').exec('tr a-z A-Z').stdout);

for (const [l, s, v] of out) console.log(s.padEnd(4), l.padEnd(24), JSON.stringify(v));
