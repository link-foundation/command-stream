// A command is an async iterable of output chunks, so output can be processed
// while the command is still running.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'async-iteration', title: 'Async iteration over output' },
  async ({ record }) => {
    const lines = [];
    for await (const chunk of $q`seq 1 5`.stream()) {
      if (chunk.type === 'exit') {
        continue;
      }
      lines.push({ type: chunk.type, data: chunk.data.toString() });
    }
    record('chunk types', [...new Set(lines.map((l) => l.type))]);
    record('collected output', lines.map((l) => l.data).join(''));

    // stdout and stderr are tagged, so both can be consumed from one loop.
    const tagged = [];
    for await (const chunk of $q`sh -c 'echo to-stdout; echo to-stderr >&2'`.stream()) {
      if (chunk.type === 'exit') {
        continue;
      }
      tagged.push([chunk.type, chunk.data.toString().trim()]);
    }
    record('tagged chunks', tagged.sort());

    // Leaving the loop early terminates the command.
    let seen = 0;
    for await (const _chunk of $q`seq 1 1000`.stream()) {
      seen++;
      break;
    }
    record('iteration can stop early', seen === 1);
  }
);
