import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureTerminal,
  openTerminal,
  readAsciicast,
  unrollTerminalFrames,
} from '../src/$.mjs';
import { stopTerminal } from '../src/terminal-pty-host-platform.mjs';
import { isWindows } from './test-helper.mjs';
import { spawnTerminalPty } from '../src/terminal-pty.mjs';

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
  test('reports a PTY host that exits before its ready handshake', async () => {
    await expect(
      spawnTerminalPty(
        process.execPath,
        [join(directory, 'fixtures/pty-host-exit.mjs')],
        {},
        {
          hostPath: join(directory, 'fixtures/pty-host-exit.mjs'),
          nodeBinary: process.execPath,
        }
      )
    ).rejects.toThrow('fixture exited before ready');
  });

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
    const settledStates = capture.frames.map(({ time: _time, ...frame }) =>
      JSON.stringify(frame)
    );
    for (let index = 1; index < settledStates.length; index += 1) {
      expect(settledStates[index]).not.toBe(settledStates[index - 1]);
    }

    const replay = await readAsciicast(join(artifactDirectory, 'session.cast'));
    expect(replay.header.width).toBe(20);
    expect(replay.events.some((event) => event.type === 'resize')).toBe(true);

    for (const artifact of [
      'transcript.txt',
      'frames.json',
      'session.cast',
      'snapshot.svg',
      'recording.svg',
      'recording.gif',
    ]) {
      expect(
        (await readFile(join(artifactDirectory, artifact))).length
      ).toBeGreaterThan(0);
    }
    const recording = await readFile(
      join(artifactDirectory, 'recording.svg'),
      'utf8'
    );
    expect(recording).toContain('@keyframes');
    expect(recording).toContain('steps(1, end)');
    expect(recording).not.toContain('<animate');
    expect(
      (await readFile(join(artifactDirectory, 'recording.gif')))
        .slice(0, 6)
        .toString()
    ).toBe('GIF89a');
    // Rendering every artifact (including the GIF) runs close to the default
    // 10 s budget on slow Windows runners.
  }, 60_000);

  test('preserves styled cells, exact grid geometry, and real timing', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'command-stream-tui-styled-')
    );
    temporaryDirectories.push(artifactDirectory);

    const capture = await captureTerminal({
      file: process.execPath,
      args: [join(directory, 'fixtures/tui-styled-fixture.mjs')],
      cols: 12,
      rows: 5,
      settleMilliseconds: 20,
      artifactDirectory,
      artifactOptions: {
        borderRadius: 0,
        cellWidth: 10,
        cellHeight: 20,
        padding: 0,
      },
    });

    const styled = capture.frames
      .flatMap((frame) => frame.cells[0])
      .find((cell) => cell.chars === 's');
    expect(styled).toMatchObject({
      fg: '#0c2238',
      bg: '#ff0000',
      bold: true,
      dim: true,
      italic: true,
      underline: true,
      strikethrough: true,
    });

    const snapshot = await readFile(
      join(artifactDirectory, 'snapshot.svg'),
      'utf8'
    );
    expect(snapshot).toContain('xml:space="preserve"');
    expect(snapshot).toMatch(/textLength="\d+"/);
    expect(snapshot).toContain('ed ⠋表');
    expect(snapshot).toContain('lengthAdjust="spacingAndGlyphs"');
    expect(snapshot).toContain('shape-rendering="crispEdges"');
    expect(snapshot).toContain('<path');
    expect(snapshot).toContain('@font-face');
    expect(snapshot).toContain('data:font/woff2;base64,');
    expect(snapshot).toContain('rx="0"');

    const recording = await readFile(
      join(artifactDirectory, 'recording.svg'),
      'utf8'
    );
    expect(recording).toContain('animation-timing-function:steps(1, end)');
    const duration = Number(
      recording.match(/animation-duration:([0-9.]+)s/)?.[1]
    );
    expect(duration).toBeGreaterThanOrEqual(0.1);
    expect(duration).toBeLessThan(0.5);
  });

  test('measures visible glyphs without stretching terminal row padding', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'command-stream-tui-padding-')
    );
    temporaryDirectories.push(artifactDirectory);

    await captureTerminal({
      file: process.execPath,
      args: ['-e', "process.stdout.write('\\u001b[3Gok 表')"],
      cols: 12,
      rows: 2,
      artifactDirectory,
      artifactOptions: {
        cellWidth: 10,
        cellHeight: 20,
        padding: 0,
      },
    });

    const snapshot = await readFile(
      join(artifactDirectory, 'snapshot.svg'),
      'utf8'
    );
    expect(snapshot).toMatch(
      /<text x="20" [^>]*textLength="50"[^>]*>ok 表<\/text>/
    );
    expect(snapshot).not.toMatch(/<text [^>]*>[ \t]/);
    expect(snapshot).not.toMatch(/[ \t]<\/text>/);
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

  test('waits for regex readiness and output quiescence before sending a raw key sequence', async () => {
    const trace = [];
    const capture = await captureTerminal({
      file: process.execPath,
      args: [
        '-e',
        [
          "process.stdin.setRawMode(true); process.stdout.write('boot:1');",
          "setTimeout(() => process.stdout.write('\\rboot:ready-42'), 30);",
          "process.stdin.once('data', data => {",
          "  process.stdout.write(`\\rkey:${data.toString('hex')}`);",
          '  process.exit(0);',
          '});',
        ].join(''),
      ],
      interactions: [
        {
          after: /boot:ready-\d+/,
          idleMilliseconds: 50,
          key: '\x1b[B',
        },
      ],
      timeoutMilliseconds: 2_000,
      onTrace: (event) => trace.push(event),
    });

    expect(capture.output).toContain('key:1b5b42');
    expect(capture.interactionCount).toBe(1);

    const finalOutput = trace.findLast(
      ({ type, data }) => type === 'output' && data.includes('boot:ready-42')
    );
    const interaction = trace.findLast(
      ({ type }) => type === 'interaction-applied'
    );
    expect(interaction.time - finalOutput.time).toBeGreaterThanOrEqual(0.04);
  });

  test('retains a state when a later repaint is split across output chunks', async () => {
    const capture = await captureTerminal({
      file: process.execPath,
      args: [join(directory, 'fixtures/tui-leading-repaint-fixture.mjs')],
      cols: 20,
      rows: 3,
      settleMilliseconds: 100,
    });

    expect(capture.transcript).toBe('first-state\nsecond-state');
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

describe('PTY terminal sessions', () => {
  test('keeps the child alive for input that arrives much later', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'command-stream-tui-session-')
    );
    temporaryDirectories.push(artifactDirectory);

    const session = await openTerminal({
      file: process.execPath,
      args: [join(directory, 'fixtures/tui-session-fixture.mjs')],
      cols: 60,
      rows: 6,
      settleMilliseconds: 10,
      artifactDirectory,
    });

    await session.waitFor(/auth-url: (\S+)/, { idleMilliseconds: 30 });
    const url = session.transcript.match(/auth-url: (\S+)/)?.[1];
    expect(url).toBe('https://example.test/device?code=42');

    // The caller leaves and comes back: nothing may terminate the child.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(session.running).toBe(true);

    await session.send({ text: '42', key: 'ENTER' });
    await session.waitFor('logged-in:42');

    // The fixture exits on its own; wait for that instead of racing close()
    // against it, because a kill during exit reports a signal exit code.
    await session.exited;
    const capture = await session.close();
    expect(capture.exitCode).toBe(0);
    expect(capture.transcript).toContain('logged-in:42');
    expect(capture.frames.length).toBeGreaterThan(0);
    expect(capture.asciicast.events.some(({ code }) => code === 'i')).toBe(
      true
    );
    expect(
      await readFile(join(artifactDirectory, 'transcript.txt'), 'utf8')
    ).toContain('logged-in:42');
    expect(session.running).toBe(false);
  });

  test('waitFor requires output quiescence and honours its own timeout', async () => {
    const session = await openTerminal({
      file: process.execPath,
      args: [join(directory, 'fixtures/tui-session-fixture.mjs')],
      cols: 60,
      rows: 6,
      settleMilliseconds: 10,
    });

    const startedAt = Date.now();
    await session.waitFor('auth-url', { idleMilliseconds: 120 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(120);
    expect(session.output).toContain('waiting for code');

    await expect(
      session.waitFor('never-printed', { timeoutMilliseconds: 100 })
    ).rejects.toThrow('Terminal waitFor timed out after 100 ms');

    await session.close();
  });

  test('rejects pending waits and later sends once the child exits', async () => {
    const session = await openTerminal({
      file: process.execPath,
      args: ['-e', "process.stdout.write('bye'); process.exit(3)"],
      cols: 40,
      rows: 4,
    });

    // Windows reports the teardown through the PTY host rather than a child
    // exit status, and ConPTY drops the output of a process this short-lived,
    // so only the rejection itself is portable.
    await expect(session.waitFor('never-printed')).rejects.toThrow(
      isWindows ? /exited/ : 'Terminal exited with code 3'
    );
    await expect(session.send({ text: 'late' })).rejects.toThrow(
      'already exited'
    );

    const capture = await session.close();
    if (!isWindows) {
      expect(capture.exitCode).toBe(3);
      expect(capture.transcript).toContain('bye');
    }
  });

  test('dispose stops a child that never exits on its own', async () => {
    const session = await openTerminal({
      file: process.execPath,
      args: [join(directory, 'fixtures/tui-hang-fixture.mjs')],
      cols: 40,
      rows: 4,
    });

    await session.waitFor('waiting for input');
    const capture = await session.dispose();
    expect(session.running).toBe(false);
    expect(capture.transcript).toContain('waiting for input');
  });

  test('requires a file just like the batch capture', async () => {
    await expect(openTerminal({})).rejects.toThrow(
      'openTerminal requires a file'
    );
    await expect(captureTerminal({})).rejects.toThrow(
      'captureTerminal requires a file'
    );
  });
});
