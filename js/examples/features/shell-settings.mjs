// Shell settings mirror `set -e`, `set -x`, `set -v` and `set -o pipefail`.
import { $, shell, set, unset } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'shell-settings', title: 'Shell settings' },
  async ({ record }) => {
    record('defaults', shell.settings());

    set('e');
    record('set("e") enables errexit', shell.settings().errexit);
    try {
      await $q`sh -c 'exit 5'`;
      record('failing command with errexit', 'did not throw');
    } catch (error) {
      record('failing command with errexit', `threw with code ${error.code}`);
    }
    unset('e');

    shell.pipefail(true);
    record(
      'pipefail makes an early failure win',
      (await $q`sh -c 'exit 3' | cat`).code
    );
    shell.pipefail(false);
    record(
      'without pipefail the last stage wins',
      (await $q`sh -c 'exit 3' | cat`).code
    );

    set('x');
    record('xtrace on', shell.settings().xtrace);
    unset('x');
    record('settings restored', shell.settings());
  }
);
