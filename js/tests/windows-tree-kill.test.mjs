import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from '../src/$.mjs';

const fixture = fileURLToPath(
  new URL('./fixtures/tree-heartbeat.mjs', import.meta.url)
);

for (const method of ['abort', 'kill']) {
  test.skipIf(process.platform !== 'win32')(
    `${method} stops descendants on Windows`,
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'command-stream-tree-'));
      const heartbeat = join(directory, 'heartbeat');
      const controller = new AbortController();
      const command = $({
        mirror: false,
        signal: controller.signal,
        killGrace: 200,
      })`${process.execPath} ${fixture} ${heartbeat}`;
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
            } else {
              command.kill();
            }
          }
        }

        expect(childPid).toBeGreaterThan(0);
        const before = readFileSync(heartbeat).length;
        await Bun.sleep(200);
        expect(readFileSync(heartbeat).length).toBe(before);
      } finally {
        if (childPid) {
          try {
            process.kill(childPid, 'SIGKILL');
          } catch {
            // Already stopped.
          }
        }
        await Bun.sleep(100);
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
}
