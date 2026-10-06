import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { $, ProcessRunner } from '../src/$.mjs';

const fixture = fileURLToPath(
  new URL('./fixtures/tree-heartbeat.mjs', import.meta.url)
);

for (const mode of ['shell', 'exec']) {
  for (const method of [
    'abort',
    'timeout',
    'kill',
    'SIGKILL',
    'zero-grace',
    'stubborn',
    'break',
  ]) {
    test(
      `${mode}: ${method} stops descendants`,
      { timeout: 8000 },
      async () => {
        const directory = mkdtempSync(join(tmpdir(), 'command-stream-tree-'));
        const heartbeat = join(directory, 'heartbeat');
        const controller = new AbortController();
        const options = {
          mirror: false,
          stdin: 'ignore',
          env: {
            ...process.env,
            COMMAND_STREAM_TEST_IGNORE_TERM: method === 'stubborn' ? '1' : '0',
          },
          signal: controller.signal,
          killGrace: method === 'zero-grace' ? 0 : 200,
        };
        const command =
          mode === 'shell'
            ? $(options)`${process.execPath} ${fixture} ${heartbeat}`
            : new ProcessRunner(
                {
                  mode: 'exec',
                  file: process.execPath,
                  args: [fixture, heartbeat],
                },
                options
              );
        let output = '';
        let childPid;

        try {
          for await (const chunk of command.stream()) {
            if (chunk.type !== 'stdout') {
              continue;
            }
            output += chunk.data.toString();
            const match = output.match(/CHILD_PID=(\d+)/);
            if (match && !childPid) {
              childPid = Number(match[1]);
              if (method === 'abort') {
                controller.abort();
              } else if (method === 'timeout') {
                // Start the timeout after readiness so slow startup cannot turn
                // this into a test that cancels before any descendant exists.
                AbortSignal.timeout(50).addEventListener('abort', () =>
                  controller.abort()
                );
              } else if (method === 'break') {
                break;
              } else {
                command.kill(method === 'SIGKILL' ? 'SIGKILL' : undefined);
              }
            }
          }

          assert.ok(childPid > 0, `fixture never became ready: ${output}`);
          assert.ok(readFileSync(heartbeat).length > 0);
          assert.equal((await command).code, method === 'SIGKILL' ? 137 : 143);
          // Awaiting a killed command can finish before POSIX grace escalation.
          await sleep(250);
          const before = readFileSync(heartbeat).length;
          await sleep(200);
          assert.equal(readFileSync(heartbeat).length, before);
        } finally {
          command.kill('SIGKILL');
          if (existsSync(`${heartbeat}.pid`)) {
            try {
              process.kill(
                Number(readFileSync(`${heartbeat}.pid`, 'utf8')),
                'SIGKILL'
              );
            } catch {
              // Already stopped.
            }
          }
          await sleep(50);
          rmSync(directory, { recursive: true, force: true });
        }
      }
    );
  }
}
