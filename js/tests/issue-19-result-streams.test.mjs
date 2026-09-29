import { expect, test } from 'bun:test';
import { Readable, Writable } from 'node:stream';
import { $, ProcessRunner, exec, sh } from '../src/$.mjs';

test('readonly native stdin methods remain accessible', () => {
  const write = () => true;
  const end = () => {};
  const stdin = {};
  Object.defineProperties(stdin, {
    write: { value: write },
    end: { value: end },
  });
  const runner = new ProcessRunner(
    { mode: 'exec', file: process.execPath, args: [] },
    { capture: true }
  );
  runner._child = { stdin };

  expect(runner.stdin).toBe(stdin);
  expect(stdin.write('input')).toBe(true);
  expect(stdin.end).toBe(end);
});

test('completed results expose readable stdout and stderr and writable stdin', async () => {
  for (const result of [
    await $`echo stream`,
    await sh('printf stream', { mirror: false }),
    await exec(process.execPath, ['-e', 'process.stdout.write("stream")'], {
      mirror: false,
    }),
  ]) {
    expect(result.stdout).toBeInstanceOf(Readable);
    expect(result.stderr).toBeInstanceOf(Readable);
    expect(result.stdin).toBeInstanceOf(Writable);
    expect(await Array.fromAsync(result.stdout)).toEqual([
      Buffer.from(result.stdout.toString()),
    ]);
  }
});

test('stdin stream on running command sends data to the child', async () => {
  const command = $`node -e "process.stdin.pipe(process.stdout)"`;
  const stdin = await command.streams.stdin;
  stdin.write('streamed input');
  stdin.end();
  const result = await command;
  expect(result.stdout.toString()).toBe('streamed input');
  expect(result.stdin.toString()).toBe('streamed input');

  const endCommand = $`node -e "process.stdin.pipe(process.stdout)"`;
  (await endCommand.streams.stdin).end('final input');
  const endResult = await endCommand;
  expect(endResult.stdin.toString()).toBe('final input');
});

test('completed streams preserve text helpers, stderr, and input snapshots', async () => {
  const result = await sh('cat; printf warning >&2', {
    stdin: 'sent input',
    mirror: false,
  });
  expect(result.stdout.toString()).toBe('sent input');
  expect(result.stderr.toString()).toBe('warning');
  expect(result.stdin.toString()).toBe('sent input');
  expect(await result.text()).toBe('sent input');
  expect(JSON.stringify(result.stdout)).toBe('"sent input"');
  expect(await Array.fromAsync(result.stderr)).toEqual([
    Buffer.from('warning'),
  ]);
  result.stdin.write(' later');
  result.stdin.end();
  expect(result.stdin.toString()).toBe('sent input later');
  expect(result.stdout.toString()).toBe('sent input');
});

test('synchronous results have readable snapshots', () => {
  const result = $`echo sync`.sync();
  expect(result.stdout).toBeInstanceOf(Readable);
  expect(result.stdout.toString().trim()).toBe('sync');
});
