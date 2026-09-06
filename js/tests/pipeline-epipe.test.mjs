import { test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { pipeStreamToProcess } from '../src/$.process-runner-pipeline.mjs';

/**
 * A process whose stdin behaves like a pipe whose reader has already gone
 * away: closing it (and, optionally, writing to it) raises EPIPE.
 * @param {object} options - Which operations should fail
 * @returns {object} A fake process with a writable stdin
 */
function procWithBrokenStdin({ failWrites = false } = {}) {
  const written = [];
  const epipe = () =>
    Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
  return {
    written,
    stdin: {
      async write(chunk) {
        if (failWrites) {
          throw epipe();
        }
        written.push(chunk);
      },
      async close() {
        throw epipe();
      },
    },
  };
}

/**
 * @param {string[]} chunks - Chunks the stream yields
 * @returns {ReadableStream} A stream over the encoded chunks
 */
function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

// Regression test: a downstream process can exit before its stdin is closed,
// and then closing that stdin raises EPIPE. A shell ignores that, so the
// pipeline must ignore it too instead of letting the rejection escape.
test('closing the stdin of an exited process does not reject', async () => {
  const proc = procWithBrokenStdin();
  await expect(
    pipeStreamToProcess(streamOf(['line 0\n']), proc)
  ).resolves.toBeUndefined();
  expect(proc.written).toHaveLength(1);
});

test('an EPIPE on write does not reject either', async () => {
  const proc = procWithBrokenStdin({ failWrites: true });
  await expect(
    pipeStreamToProcess(streamOf(['line 0\n', 'line 1\n']), proc)
  ).resolves.toBeUndefined();
  expect(proc.written).toHaveLength(0);
});

test('a process without stdin is left alone', () => {
  expect(pipeStreamToProcess(streamOf(['x']), {})).toBeUndefined();
});
