import { test, expect } from 'bun:test';
import * as api from '../src/$.mjs';

test('terminal buffer emits changed frames and renders optional colors on demand', async () => {
  expect(typeof api.TerminalBuffer).toBe('function');
  const buffer = new api.TerminalBuffer({
    cols: 12,
    rows: 3,
    frameInterval: 0,
  });
  const frames = [];
  buffer.on('frame', (frame) => frames.push(frame));
  try {
    await buffer.write('\x1b[31mold\x1b[0m\r\x1b[32mnew\x1b[0m');
    await buffer.flush();
    expect(buffer.text()).toBe('new');
    expect(buffer.text({ color: true })).toContain('\x1b[');
    expect(frames.length).toBe(1);
    await buffer.write('');
    await buffer.flush();
    expect(frames.length).toBe(1);
    buffer.resize(20, 4);
    await buffer.flush();
    expect(buffer.snapshot().cols).toBe(20);
  } finally {
    buffer.dispose();
  }
});

test('terminal frames iterator keeps the newest change without unbounded history', async () => {
  expect(typeof api.TerminalBuffer).toBe('function');
  const buffer = new api.TerminalBuffer({
    cols: 12,
    rows: 3,
    frameInterval: 0,
  });
  const iterator = buffer.frames();
  const pending = iterator.next();
  await buffer.write('hello');
  await buffer.flush();
  expect((await pending).value.screen).toEqual(['hello']);
  await iterator.return();
  buffer.dispose();
});

test('terminal handles split UTF-8, split escapes, and alternate-screen restoration', async () => {
  const buffer = new api.TerminalBuffer({ cols: 12, rows: 3 });
  try {
    const bytes = Buffer.from('€');
    await buffer.write(bytes.subarray(0, 1));
    await buffer.write(bytes.subarray(1));
    await buffer.write('\x1b[3');
    await buffer.write('1mred\x1b[0m');
    expect(buffer.text()).toBe('€red');
    await buffer.write('\x1b[?1049hother');
    expect(buffer.snapshot().alternate).toBe(true);
    await buffer.write('\x1b[?1049l');
    expect(buffer.text()).toBe('€red');
  } finally {
    buffer.dispose();
  }
});

test('disposing a buffer settles queued writes and waiting frame readers', async () => {
  const buffer = new api.TerminalBuffer();
  const frame = buffer.frames().next();
  const write = buffer.write('queued');
  buffer.dispose();
  await expect(write).rejects.toThrow('disposed');
  expect((await frame).done).toBe(true);
});
