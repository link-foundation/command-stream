// Environment built-ins: pwd, cd, env, which, sleep, exit.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import path from 'path';

await example({ id: 'builtin-environment', title: 'Environment built-ins' }, async ({ record }) => {
  const dir = makeTempDir('env');
  const $q = $({ mirror: false });

  record('pwd inside a chosen directory', (await $({ mirror: false, cwd: dir })`pwd`).stdout);

  // cd changes the working directory of the process, and is remembered by the
  // following commands.
  const before = (await $q`pwd`).stdout.trim();
  await $q`cd ${dir}`;
  record('pwd after cd', (await $q`pwd`).stdout);
  await $q`cd ${before}`;
  record('back in the original directory', (await $q`pwd`).stdout);

  const withEnv = await $({ mirror: false, env: { DEMO: 'value' } })`env`;
  record('env lists the variables', withEnv.stdout);

  record('which finds a binary', (await $q`which sh`).code);

  const started = Date.now();
  await $q`sleep 0.1`;
  record('sleep waited', Date.now() - started >= 90);
});
