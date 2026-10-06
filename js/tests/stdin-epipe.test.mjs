import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test } from 'node:test';
import { StreamUtils } from '../src/$.stream-utils.mjs';

test('writing stdin handles an asynchronous EPIPE from a closed child', async () => {
  const stream = new Writable({
    write(_data, _encoding, callback) {
      callback(
        Object.assign(new Error('child closed stdin'), { code: 'EPIPE' })
      );
    },
  });
  await StreamUtils.writeToStream(stream, Buffer.from('unused input'), 'stdin');
  await nextTurn();
  assert.equal(stream.destroyed, true);
});

test('repeated stdin writes install a single error handler', async () => {
  const stream = new Writable({
    write(_data, _encoding, callback) {
      callback();
    },
  });
  for (let i = 0; i < 20; i++) {
    await StreamUtils.writeToStream(stream, Buffer.from('input'), 'stdin');
  }
  assert.equal(stream.listenerCount('error'), 1);
  stream.destroy();
});
