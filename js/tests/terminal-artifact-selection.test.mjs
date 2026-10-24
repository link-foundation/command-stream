// Issue #231: `artifacts` selects which files `artifactDirectory` receives,
// and the renderers for unrequested artifacts (notably the GIF) are skipped.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { captureTerminal, openTerminal } from '../src/$.mjs';
import {
  TERMINAL_ARTIFACTS,
  writeTerminalArtifacts,
} from '../src/terminal-artifacts.mjs';

const temporaryDirectories = [];

const temporaryDirectory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'command-stream-artifacts-'));
  temporaryDirectories.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

const frame = {
  time: 0,
  cols: 4,
  rows: 1,
  cursor: { x: 0, y: 0 },
  alternate: false,
  lines: ['hi'],
  screen: ['hi  '],
  cells: [],
};
const asciicast = {
  header: { version: 2, width: 4, height: 1, timestamp: 0, env: {} },
  events: [{ time: 0, code: 'o', data: 'hi' }],
};

describe('terminal artifact selection', () => {
  test('captureTerminal writes only the requested artifacts', async () => {
    const artifactDirectory = await temporaryDirectory();
    const capture = await captureTerminal({
      file: process.execPath,
      args: ['-e', 'console.log("selected")'],
      cols: 20,
      rows: 3,
      artifactDirectory,
      artifacts: ['transcript', 'snapshot'],
    });

    expect(capture.exitCode).toBe(0);
    expect((await readdir(artifactDirectory)).sort()).toEqual([
      'snapshot.svg',
      'transcript.txt',
    ]);
    expect(
      await readFile(join(artifactDirectory, 'transcript.txt'), 'utf8')
    ).toContain('selected');
  }, 30_000);

  test('omitting artifacts keeps writing every file', async () => {
    const directory = await temporaryDirectory();
    await writeTerminalArtifacts({
      directory,
      frames: [frame],
      transcript: 'hi',
      asciicast,
    });
    expect((await readdir(directory)).sort()).toEqual(
      Object.values(TERMINAL_ARTIFACTS).sort()
    );
  }, 30_000);

  test('an empty selection writes nothing but still creates the directory', async () => {
    const directory = join(await temporaryDirectory(), 'nested');
    await writeTerminalArtifacts({
      directory,
      frames: [frame],
      transcript: 'hi',
      asciicast,
      artifacts: [],
    });
    expect(await readdir(directory)).toEqual([]);
  });

  test('each name maps to exactly its own file', async () => {
    for (const [name, file] of Object.entries(TERMINAL_ARTIFACTS)) {
      const directory = await temporaryDirectory();
      await writeTerminalArtifacts({
        directory,
        frames: [frame],
        transcript: 'hi',
        asciicast,
        artifacts: [name],
      });
      expect(await readdir(directory)).toEqual([file]);
    }
  }, 30_000);

  test('unknown artifact names are rejected before anything is spawned', async () => {
    await expect(
      openTerminal({
        file: process.execPath,
        args: ['-e', ''],
        artifacts: ['transcript', 'video'],
      })
    ).rejects.toThrow(/openTerminal artifacts has unknown name "video"/);
    await expect(
      captureTerminal({ file: process.execPath, artifacts: 'gif' })
    ).rejects.toThrow(/captureTerminal artifacts must be an array/);
  });
});
