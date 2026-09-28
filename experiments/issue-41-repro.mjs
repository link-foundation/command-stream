import { $ } from '../js/src/$.mjs';

const dir = '/tmp/space test dir';
const filePath = `${dir}/report file.txt`;

async function t(name, fn) {
  try {
    const r = await fn();
    console.log(
      `[${name}] code=${r.code} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`
    );
  } catch (e) {
    console.log(`[${name}] THREW ${e.message}`);
  }
}

await t('cat unquoted interp', () => $({ mirror: false })`cat ${filePath}`);
await t('cat quoted interp', () => $({ mirror: false })`cat "${filePath}"`);
await t('ls dir', () => $({ mirror: false })`ls ${dir}`);
await t('echo path', () => $({ mirror: false })`echo ${filePath}`);
await t('cd + pwd', () => $({ mirror: false })`cd ${dir} && pwd`);
await t(
  'builtin cat via virtual?',
  () => $({ mirror: false })`cat ${filePath} | head -1`
);
await t(
  'test -f',
  () => $({ mirror: false })`test -f ${filePath} && echo EXISTS`
);
await t('cp', () => $({ mirror: false })`cp ${filePath} ${dir}/copy\ file.txt`);
console.log('cmd:', $({ mirror: false })`cat ${filePath}`.spec.command);
