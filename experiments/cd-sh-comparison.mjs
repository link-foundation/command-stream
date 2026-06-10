import { $ } from '../src/$.mjs';

const tmp = '/tmp/cs-cd-test';
await $`rm -rf ${tmp}`;
await $`mkdir -p ${tmp}/sub`;

console.log('=== Test 1: cd - (previous dir) ===');
try {
  process.chdir(tmp);
  await $`cd sub`;
  console.log('after cd sub, cwd=', process.cwd());
  const r = await $`cd -`;
  console.log('cd - stdout:', JSON.stringify(r.stdout), 'code:', r.code, 'cwd now:', process.cwd());
} catch(e) { console.log('cd - error:', e.message); }

console.log('=== Test 2: $PWD env var ===');
process.chdir(tmp);
const pwdEnv = await $`echo $PWD`;
console.log('echo $PWD ->', JSON.stringify(pwdEnv.stdout), ' actual process.cwd:', process.cwd());

console.log('=== Test 3: subshell isolation (cd x); pwd ===');
process.chdir(tmp);
const sub = await $`(cd sub && pwd) ; pwd`;
console.log('subshell stdout:', JSON.stringify(sub.stdout));
console.log('process.cwd after subshell:', process.cwd());

console.log('=== Test 4: cwd option with cd ===');
const r4 = await $({cwd: tmp})`cd sub && pwd`;
console.log('cwd-option cd sub && pwd ->', JSON.stringify(r4.stdout), 'code', r4.code);

process.chdir('/tmp');
