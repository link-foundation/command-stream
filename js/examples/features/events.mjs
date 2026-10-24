// Commands are EventEmitters: 'stdout', 'stderr', 'data' and 'end'.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'events', title: 'EventEmitter interface' },
  async ({ record }) => {
    const events = [];

    await new Promise((resolve, reject) => {
      $q`sh -c 'echo out; echo err >&2'`
        .on('stdout', (data) => events.push(['stdout', data.toString().trim()]))
        .on('stderr', (data) => events.push(['stderr', data.toString().trim()]))
        .on('end', (result) => {
          events.push(['end', result.code]);
          resolve();
        })
        .on('error', reject)
        .start();
    });

    record(
      'events (sorted: stdout/stderr order is up to the OS)',
      events.sort()
    );

    // The 'data' event receives both streams with a type tag.
    const tagged = [];
    await new Promise((resolve) => {
      $q`echo tagged`
        .on('data', (chunk) =>
          tagged.push([chunk.type, chunk.data.toString().trim()])
        )
        .on('end', () => resolve())
        .start();
    });
    record('data events', tagged);
  }
);
