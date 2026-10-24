import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { TerminalBuffer, openTerminal, captureTerminal } from '../src/$.mjs';
import { spawnTerminalPty } from '../src/terminal-pty.mjs';

const mockPtyHost = () => {
  const host = new EventEmitter();
  host.stdout = new PassThrough();
  host.stderr = new PassThrough();
  host.stdin = new PassThrough();
  host.stdin.on('data', () => host.stdout.write('{"type":"ready"}\n'));
  return host;
};

test('PTY host exit waits for the terminal status still buffered on stdout', async () => {
  const host = mockPtyHost();
  const terminal = await spawnTerminalPty(
    'fixture',
    [],
    {},
    {
      spawn: () => host,
    }
  );
  const statuses = [];
  const output = [];
  terminal.onExit((status) => statuses.push(status));
  terminal.onData((data) => output.push(data));

  // Child-process exit can precede pipe delivery. Close follows drained streams.
  host.emit('exit', 0);
  host.stdout.write('{"type":"data","data":"bye"}\n');
  host.stdout.write('{"type":"exit","exitCode":3,"signal":0}\n');
  host.stdout.end();
  host.stderr.end();
  host.emit('close', 0);

  assert.deepEqual(statuses, [{ type: 'exit', exitCode: 3, signal: 0 }]);
  assert.deepEqual(output, ['bye']);
});

test(
  'missing PTY status is reported after pipe drain even without close',
  { timeout: 1000 },
  async () => {
    const host = mockPtyHost();
    const terminal = await spawnTerminalPty(
      'fixture',
      [],
      {},
      { spawn: () => host }
    );
    const status = new Promise((resolve) => terminal.onExit(resolve));
    host.emit('exit', 0);
    host.stdout.end();
    host.stderr.end('host diagnostic');
    const result = await status;
    assert.equal(result.exitCode, 0);
    assert.match(
      result.error.message,
      /PTY host exited with code 0: host diagnostic/
    );
  }
);

test(
  'an exited PTY host with an open stdout pipe still finishes and releases pipes',
  { timeout: 1000 },
  async () => {
    const host = mockPtyHost();
    const terminal = await spawnTerminalPty(
      'fixture',
      [],
      {},
      { spawn: () => host }
    );
    const status = new Promise((resolve) => terminal.onExit(resolve));
    host.emit('exit', 0);
    host.stderr.end('host diagnostic');
    const result = await status;
    assert.match(result.error.message, /host diagnostic/);
    assert.equal(host.stdin.destroyed, true);
    assert.equal(host.stdout.destroyed, true);
    assert.equal(host.stderr.destroyed, true);
  }
);

test(
  'a late buffered terminal status survives a host exit without stdout end',
  { timeout: 1000 },
  async () => {
    const host = mockPtyHost();
    const terminal = await spawnTerminalPty(
      'fixture',
      [],
      {},
      { spawn: () => host }
    );
    const statuses = [];
    terminal.onExit((status) => statuses.push(status));
    const closed = new Promise((resolve) => host.stdout.on('close', resolve));
    host.emit('exit', 0);
    host.stderr.end();
    setTimeout(() => {
      host.stdout.write('{"type":"exit","exitCode":3,"signal":0}\n');
    }, 10);
    await closed;
    assert.deepEqual(statuses, [{ type: 'exit', exitCode: 3, signal: 0 }]);
  }
);

test('compact changes preserve colors, cursor movement, clearing and resize', async () => {
  const buffer = new TerminalBuffer({ cols: 8, rows: 2, frameInterval: 0 });
  const changes = [];
  buffer.on('change', (change) => changes.push(change));
  try {
    await buffer.write('hello');
    await buffer.flush();
    await buffer.write('\r\x1b[31mH');
    await buffer.flush();
    assert.equal(changes.length, 2);
    assert.equal(changes[1].sequence, 2);
    assert.deepEqual(
      changes[1].updates.map((row) => row.y),
      [0]
    );
    assert.equal(changes[1].updates[0].cells[0].fg, '#cd0000');
    assert.equal(changes[1].cells, undefined);
    await buffer.write('\x1b[2;2H');
    await buffer.flush();
    assert.deepEqual(changes.at(-1).updates, []);
    await buffer.write('\x1b[2J');
    await buffer.flush();
    assert.equal(changes.at(-1).updates[0].text, '');
    buffer.resize(10, 3);
    await buffer.flush();
    assert.equal(changes.at(-1).reset, true);
    assert.equal(changes.at(-1).updates.length, 3);
    const count = changes.length;
    await buffer.write('');
    await buffer.flush();
    assert.equal(changes.length, count);
  } finally {
    buffer.dispose();
  }
});

test('change streams queue every published delta and drain on disposal', async () => {
  const buffer = new TerminalBuffer({ cols: 8, rows: 2, frameInterval: 0 });
  const stream = buffer.changes();
  const first = stream.next();
  await buffer.write('a');
  assert.equal((await first).value.sequence, 1);
  await buffer.write('b');
  await buffer.write('c');
  buffer.dispose();
  assert.equal((await stream.next()).value.sequence, 2);
  assert.equal((await stream.next()).value.sequence, 3);
  assert.equal((await stream.next()).done, true);
});

test('bounded delta streams report overflow and clean up abort listeners', async () => {
  const buffer = new TerminalBuffer({ cols: 8, rows: 2, frameInterval: 0 });
  try {
    const stream = buffer.changes({ capacity: 1 });
    const first = stream.next();
    await buffer.write('a');
    await first;
    await buffer.write('b');
    await buffer.write('c');
    await assert.rejects(stream.next(), /overflow/i);
    const controller = new AbortController();
    const aborted = buffer.changes({ signal: controller.signal });
    const waiting = aborted.next();
    controller.abort();
    assert.equal((await waiting).done, true);
    assert.equal(buffer.listenerCount('change'), 0);
  } finally {
    buffer.dispose();
  }
});

test(
  'live PTY frames and changes support simultaneous input, queries and resizing',
  { timeout: 10000, skip: process.platform === 'win32' },
  async () => {
    const program = `
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write('READY\\x1b[6n');
    process.stdin.on('data', data => {
      if (data.toString().includes('R')) process.stdout.write('QUERY-OK');
      if (data.toString().includes('q')) process.exit(0);
    });
    process.on('SIGWINCH', () => process.stdout.write('SIZE:' + process.stdout.columns + 'x' + process.stdout.rows));
  `;
    const session = await openTerminal({
      file: process.execPath,
      args: ['-e', program],
      cols: 33,
      rows: 7,
      frameMode: 'writes',
      timeoutMilliseconds: 5000,
    });
    try {
      const stream = session.changes();
      const first = stream.next();
      await session.waitFor('QUERY-OK', { timeoutMilliseconds: 2000 });
      assert.ok((await first).value.updates.length);
      assert.ok(session.snapshot().screen.join('\n').includes('QUERY-OK'));
      await session.send({ resize: { cols: 41, rows: 9 } });
      await session.waitFor('SIZE:41x9', { timeoutMilliseconds: 2000 });
      assert.equal(session.snapshot().cols, 41);
      await session.send({ text: 'q' });
      await session.finished();
      const remaining = [];
      for await (const change of stream) {
        remaining.push(change);
      }
      assert.ok(remaining.some((change) => change.reset && change.cols === 41));
    } finally {
      await session.dispose();
    }
  }
);

test('invalid PTY dimensions are rejected before starting a child', async () => {
  for (const cols of [0, -1, 1.5, NaN, Infinity, 1000001]) {
    await assert.rejects(
      openTerminal({ file: 'node', cols, rows: 2 }),
      /dimensions/i
    );
  }
});

test(
  'a virtual PTY uses its own TERM unless explicitly configured',
  { timeout: 10000 },
  async () => {
    const inheritedTerm = process.env.TERM;
    process.env.TERM = 'dumb';
    try {
      const options = {
        file: process.execPath,
        args: ['-e', 'console.log(process.env.TERM)'],
        timeoutMilliseconds: 2000,
      };
      assert.equal(
        (await captureTerminal(options)).transcript.trim(),
        'xterm-256color'
      );
      assert.equal(
        (
          await captureTerminal({
            ...options,
            env: { ...process.env, TERM: 'vt100' },
          })
        ).transcript.trim(),
        'vt100'
      );
    } finally {
      if (inheritedTerm === undefined) {
        delete process.env.TERM;
      } else {
        process.env.TERM = inheritedTerm;
      }
    }
  }
);

test(
  'streams finish on natural exit without retaining a recording',
  { timeout: 5000 },
  async () => {
    const session = await openTerminal({
      file: process.execPath,
      args: ['-e', "setTimeout(() => process.stdout.write('done'), 50)"],
      recording: false,
      frameMode: 'writes',
      timeoutMilliseconds: 2000,
    });
    const changes = [];
    try {
      for await (const change of session.changes()) {
        changes.push(change);
      }
      assert.ok(changes.length > 0);
      assert.equal(session.text(), 'done');
      assert.equal(session.frames.length, 1);
      assert.equal(session.asciicast.events.length, 0);
    } finally {
      await session.dispose();
    }
  }
);

test('deltas reconstruct wide text, scrollback, attributes and alternate screens', async () => {
  const buffer = new TerminalBuffer({
    cols: 8,
    rows: 2,
    scrollback: 3,
    frameInterval: 0,
  });
  let cells = JSON.parse(JSON.stringify(buffer.snapshot().cells));
  let lines = [];
  buffer.on('change', (change) => {
    if (change.reset) {
      cells = Array.from({ length: change.rows }, () => []);
      lines = [];
    }
    for (const row of change.updates) {
      cells[row.y] = row.cells;
    }
    lines.splice(
      change.history.start,
      change.history.deleteCount,
      ...change.history.lines
    );
  });
  try {
    for (const text of [
      '界e\u0301',
      '\r\nsecond\r\nthird',
      '\x1b[H\x1b[44m \x1b[0m',
      '\x1b[?1049hALT',
      '\x1b[?1049l',
    ]) {
      await buffer.write(text);
      assert.deepEqual(cells, buffer.snapshot().cells);
      assert.deepEqual(lines, buffer.snapshot().lines);
    }
  } finally {
    buffer.dispose();
  }
});

test('colored text preserves rows consisting of styled spaces', async () => {
  const buffer = new TerminalBuffer({ cols: 8, rows: 2, frameInterval: 0 });
  try {
    await buffer.write('\x1b[44m   \x1b[0m');
    assert.equal(buffer.text(), '');
    assert.ok(buffer.text({ color: true }).includes('48;2;0;0;238'));
  } finally {
    buffer.dispose();
  }
});

test(
  'interactive top accepts input while emitting live frames and resize changes',
  { timeout: 10000, skip: process.platform !== 'linux' },
  async () => {
    const session = await openTerminal({
      file: 'top',
      args: ['-d', '0.1'],
      cols: 60,
      rows: 12,
      env: { ...process.env, TERM: 'xterm-256color', LC_ALL: 'C' },
      frameMode: 'writes',
      timeoutMilliseconds: 5000,
    });
    const frames = [];
    const changes = [];
    const unsubscribeFrame = session.onFrame((frame) => frames.push(frame));
    const unsubscribeChange = session.onChange((change) =>
      changes.push(change)
    );
    try {
      await session.waitFor('Tasks:', { idleMilliseconds: 30 });
      await session.send({ resize: { cols: 80, rows: 16 } });
      await session.waitFor('Tasks:', { idleMilliseconds: 30 });
      await session.send({ key: 'q' });
      assert.equal((await session.finished()).exitCode, 0);
      assert.ok(
        frames.some((frame) => frame.screen.join('\n').includes('Tasks:'))
      );
      assert.ok(changes.some((change) => change.reset && change.cols === 80));
      assert.equal(session.snapshot().rows, 16);
    } finally {
      unsubscribeFrame();
      unsubscribeChange();
      await session.dispose();
    }
  }
);

test(
  'captures real top animation frames and GIF/SVG artifacts',
  {
    timeout: 10000,
    skip: process.platform !== 'linux',
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'command-stream-top-'));
    try {
      const capture = await captureTerminal({
        file: 'top',
        args: ['-d', '0.1', '-n', '3'],
        cols: 60,
        rows: 12,
        env: { ...process.env, TERM: 'xterm-256color', LC_ALL: 'C' },
        frameMode: 'writes',
        timeoutMilliseconds: 5000,
        artifactDirectory: directory,
      });
      assert.equal(capture.exitCode, 0);
      assert.ok(capture.frames.length >= 2);
      assert.ok(
        capture.frames.some((frame) =>
          frame.screen.join('\n').includes('Tasks:')
        )
      );
      assert.ok(
        capture.frames.every((frame) => frame.cols === 60 && frame.rows === 12)
      );
      assert.equal(
        (await readFile(join(directory, 'recording.gif')))
          .subarray(0, 6)
          .toString(),
        'GIF89a'
      );
      assert.ok(
        (await readFile(join(directory, 'recording.svg'), 'utf8')).includes(
          '@keyframes'
        )
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
