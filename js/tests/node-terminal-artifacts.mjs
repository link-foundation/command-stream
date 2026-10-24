import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { writeTerminalArtifacts } from '../src/terminal-artifacts.mjs';

test('writes GIF terminal artifacts in Node.js', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'command-stream-node-gif-'));
  context.after(() => rm(directory, { force: true, recursive: true }));

  await writeTerminalArtifacts({
    directory,
    frames: [
      {
        time: 0,
        cols: 1,
        rows: 1,
        lines: [''],
        cells: [[]],
      },
    ],
    transcript: '',
    asciicast: {
      header: { version: 2, width: 1, height: 1, timestamp: 0, env: {} },
      events: [],
    },
  });

  const gif = await readFile(join(directory, 'recording.gif'));
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
});
