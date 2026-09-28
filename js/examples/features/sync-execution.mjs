// .sync() runs a command synchronously and returns the finished result.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';
import { Readable } from 'node:stream';

const $q = $({ mirror: false });

await example(
  { id: 'sync-execution', title: 'Synchronous execution' },
  async ({ record }) => {
    const result = $q`echo synchronous`.sync();
    record('stdout', result.stdout);
    record('code', result.code);
    record(
      'result is available without await',
      result.stdout instanceof Readable
    );

    const failed = $q`sh -c 'exit 3'`.sync();
    record('exit code of a failing command', failed.code);

    record(
      'order of execution',
      (() => {
        const order = [];
        order.push('before');
        $q`echo ignored`.sync();
        order.push('after');
        return order;
      })()
    );
  }
);
