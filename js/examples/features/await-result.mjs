// Awaiting a command returns a result object with stdout, stderr and the exit code.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'await-result', title: 'Await a command' },
  async ({ record }) => {
    const result = await $q`echo "hello world"`;
    record('stdout', result.stdout);
    record('stderr', result.stderr);
    record('code', result.code);

    const system = await $q`sh -c 'printf out; printf err >&2'`;
    record('stdout of a system binary', system.stdout);
    record('stderr of a system binary', system.stderr);

    record('interpolated value', (await $q`echo ${'a value'}`).stdout);
  }
);
