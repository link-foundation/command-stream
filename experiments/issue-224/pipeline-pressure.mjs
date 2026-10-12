// Finite cross-runtime probe: a paused native pipeline must stop its generator.
import assert from 'node:assert/strict';
import $ from '../../js/src/$.mjs';
let produced = 0;
$.create('bounded-source', async function* () {
  for (let i = 0; i < 200; i++) {
    produced++;
    yield `${'x'.repeat(16383)}\n`;
  }
});
try {
  const runner = $({
    mirror: false,
    capture: false,
  })`bounded-source | ${process.execPath} -e 'process.stdin.pipe(process.stdout)'`;
  const iterator = runner.stream({ highWaterMark: 1, highWaterBytes: 16384 });
  const first = await iterator.next();
  await new Promise((resolve) => setTimeout(resolve, 40));
  const pausedAt = produced;
  let bytes = first.value.type === 'stdout' ? first.value.data.length : 0;
  for await (const chunk of iterator) {
    if (chunk.type === 'stdout') {
      bytes += chunk.data.length;
    }
  }
  assert.ok(pausedAt < 200, `pulled all ${pausedAt} chunks while paused`);
  assert.equal(runner.result.stdout ?? '', '', 'capture:false retained output');
  assert.equal(runner.result.code, 0);
  assert.equal(bytes, 200 * 16384);
  console.log(
    JSON.stringify({
      runtime: process.versions.bun ? 'bun' : 'node',
      pausedAt,
      bytes,
    })
  );
} finally {
  $.unregister('bounded-source');
}
