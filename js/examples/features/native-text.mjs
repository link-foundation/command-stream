import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'native-text', title: 'Native text commands' },
  async ({ record }) => {
    const input = 'b\nb\na\n';
    const quiet = $({ stdin: input, mirror: false });
    record('head', (await quiet`head -n 2`).stdout.toString());
    record('tail', (await quiet`tail -n 1`).stdout.toString());
    record('sort', (await quiet`sort -u`).stdout.toString());
    record('uniq', (await quiet`uniq -cd`).stdout.toString());
    record('zero lines', (await quiet`tail -n 0`).stdout.toString());
  }
);
