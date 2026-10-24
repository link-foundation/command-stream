// .buffers and .strings expose the output as Buffers or as decoded strings.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'buffers-strings', title: 'Buffer and string interfaces' },
  async ({ record }) => {
    const asBuffer = await $q`echo buffered`.buffers.stdout;
    record('buffers.stdout is a Buffer', Buffer.isBuffer(asBuffer));
    record('buffers.stdout content', asBuffer.toString());

    const asString = await $q`echo stringified`.strings.stdout;
    record('strings.stdout', asString);

    const stderrBuffer = await $q`sh -c 'echo problem >&2'`.buffers.stderr;
    record('buffers.stderr content', stderrBuffer.toString());

    // Binary-safe: bytes survive the round trip unchanged.
    const bytes = await $q`printf 'a\\tb'`.buffers.stdout;
    record('raw bytes', Array.from(bytes));
  }
);
