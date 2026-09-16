// Exit codes are reported on the result; errors are thrown only when asked for.
import { $, shell } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example({ id: 'exit-codes', title: 'Exit codes and errors' }, async ({ record }) => {
  record('successful command', (await $q`sh -c 'exit 0'`).code);
  record('failing command', (await $q`sh -c 'exit 42'`).code);
  record('stderr of a failing command', (await $q`sh -c 'echo nope >&2; exit 1'`).stderr);

  // With errexit (set -e) a non-zero exit code becomes an exception.
  shell.errexit(true);
  try {
    await $q`sh -c 'exit 42'`;
    record('errexit', 'no error thrown');
  } catch (error) {
    record('errexit throws', { code: error.code, hasResult: !!error.result });
  } finally {
    shell.errexit(false);
  }

  record('after disabling errexit', (await $q`sh -c 'exit 42'`).code);
});
