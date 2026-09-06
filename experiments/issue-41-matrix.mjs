import { $ } from '../js/src/$.mjs';
import fs from 'fs';

const dir = '/tmp/space test dir';
const filePath = `${dir}/report file.txt`;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(filePath, 'hello content\n');

async function t(name, fn) {
  try {
    const r = await fn();
    console.log(
      `[${name}] code=${r.code} out=${JSON.stringify(r.stdout)} err=${JSON.stringify((r.stderr || '').slice(0, 120))}`
    );
  } catch (e) {
    console.log(`[${name}] THREW ${e.message}`);
  }
}

// redirection to a path with spaces
await t(
  'redirect out',
  () => $({ mirror: false })`echo hi > ${dir}/out file.txt`
);
await t(
  'redirect out interp full path',
  () => $({ mirror: false })`echo hi > ${dir + '/out2.txt'}`
);
await t('read back', () => $({ mirror: false })`cat ${dir + '/out2.txt'}`);
// virtual/builtin commands
await t('cd virtual', () => $({ mirror: false })`cd ${dir}`);
await t('pwd after cd', () => $({ mirror: false })`cd ${dir} && pwd`);
await t('echo builtin', () => $({ mirror: false })`echo ${'a b'} ${'c d'}`);
// pipeline with spaces
await t(
  'pipe grep',
  () => $({ mirror: false })`cat ${filePath} | grep ${'hello content'}`
);
// array interpolation
await t('array args', () => $({ mirror: false })`echo ${['a b', 'c d']}`);
// sh -c inner
await t('sh -c', () => $({ mirror: false })`sh -c "cat '${filePath}'"`);
await t(
  'sh -c double',
  () => $({ mirror: false })`sh -c "cat \"${filePath}\""`
);
// trailing/leading spaces value
await t(
  'value with quotes literal',
  () => $({ mirror: false })`echo ${"'quoted'"}`
);
await t('value with tab', () => $({ mirror: false })`echo ${'a\tb'} | cat -A`);
// backslash in path
await t(
  'backslash path',
  () => $({ mirror: false })`echo ${'/tmp/back\\slash'}`
);
// env var in path should not expand
await t('dollar path', () => $({ mirror: false })`echo ${'/tmp/$HOME/x'}`);
// glob dir with space
await t('ls glob', () => $({ mirror: false })`ls ${dir}/*.txt`);
