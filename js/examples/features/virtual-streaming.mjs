// A handler written as an async generator streams its output chunk by chunk,
// so consumers see data before the command has finished.
import { $, register, unregister } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'virtual-streaming', title: 'Streaming commands' },
  async ({ record }) => {
    register('countdown', async function* ({ args }) {
      for (let i = Number(args[0] ?? 3); i > 0; i--) {
        yield `${i}\n`;
      }
      yield 'liftoff\n';
    });

    const chunks = [];
    for await (const chunk of $({ mirror: false })`countdown 3`.stream()) {
      if (chunk.type === 'exit') {
        continue;
      }
      chunks.push(chunk.data.toString());
    }
    record('chunks received one by one', chunks);
    record(
      'same command awaited as a whole',
      (await $({ mirror: false })`countdown 2`).stdout
    );

    // Streaming commands compose with the rest of a pipeline.
    record(
      'piped into a built-in',
      (await $({ mirror: false })`countdown 2 | cat`).stdout
    );

    unregister('countdown');
  }
);
