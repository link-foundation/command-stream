import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureTerminal,
  readAsciicast,
  unrollTerminalFrames,
} from '../src/$.mjs';
import { stopTerminal } from '../src/terminal-pty-host-platform.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe('PTY terminal capture', () => {
  test('stops Windows terminals without passing an unsupported signal', () => {
    const calls = [];
    const terminal = {
      kill(...args) {
        calls.push(args);
      },
    };

    stopTerminal(terminal, 'SIGTERM', 'win32');

    expect(calls).toEqual([[]]);
  });

  test('drives input and resize while retaining settled, deduplicated frames', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'command-stream-tui-')
    );
    temporaryDirectories.push(artifactDirectory);

    const capture = await captureTerminal({
      file: process.execPath,
      args: [join(directory, 'fixtures/tui-capture-fixture.mjs')],
      cols: 20,
      rows: 4,
      settleMilliseconds: 10,
      interactions: [
        { after: 'ready:true:20x4', text: 'hello', key: 'ENTER' },
        { after: 'typed:hello', resize: { cols: 32, rows: 6 } },
      ],
      stopMarker: 'resized:32x6',
      artifactDirectory,
    });

    expect(capture.exitCode).toBe(0);
    expect(capture.interactionCount).toBe(2);
    expect(capture.transcript).toContain('ready:true:20x4');
    expect(capture.transcript).toContain('typed:hello');
    expect(capture.transcript).toContain('resized:32x6');
    expect(capture.frames.length).toBeLessThan(8);

    const replay = await readAsciicast(join(artifactDirectory, 'session.cast'));
    expect(replay.header.width).toBe(20);
    expect(replay.events.some((event) => event.type === 'resize')).toBe(true);

    for (const artifact of [
      'transcript.txt',
      'frames.json',
      'session.cast',
      'snapshot.svg',
      'recording.svg',
    ]) {
      expect(
        (await readFile(join(artifactDirectory, artifact))).length
      ).toBeGreaterThan(0);
    }
    expect(
      await readFile(join(artifactDirectory, 'recording.svg'), 'utf8')
    ).toContain('<animate');
  });

  test('unrolls scrolled-off lines in order and exactly once', async () => {
    const capture = await captureTerminal({
      file: process.execPath,
      args: [join(directory, 'fixtures/tui-scroll-fixture.mjs')],
      cols: 20,
      rows: 3,
      settleMilliseconds: 5,
    });

    expect(capture.transcript).toContain('alpha\nbeta\ngamma\ndelta\nepsilon');
    for (const line of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      expect(capture.transcript.split(line)).toHaveLength(2);
    }
  });

  test('retains repeated content when another state appeared between it', () => {
    const frame = (lines) => ({ lines });
    expect(
      unrollTerminalFrames([
        frame(['same']),
        frame(['different']),
        frame(['same']),
      ])
    ).toBe('same\ndifferent\nsame');
  });

  test('writes partial artifacts when a terminal command times out', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'command-stream-tui-timeout-')
    );
    temporaryDirectories.push(artifactDirectory);

    let failure;
    try {
      await captureTerminal({
        file: process.execPath,
        args: [join(directory, 'fixtures/tui-hang-fixture.mjs')],
        timeoutMilliseconds: 250,
        artifactDirectory,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toContain('timed out');
    expect(failure?.capture.transcript).toContain('waiting for input');
    expect(
      (await readFile(join(artifactDirectory, 'recording.svg'))).length
    ).toBeGreaterThan(0);
  });
});
