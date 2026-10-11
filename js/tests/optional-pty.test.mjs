import { describe, expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnTerminalPty } from '../src/terminal-pty.mjs';

describe('optional PTY support (issue #218)', () => {
  test('native PTY installation cannot fail the core package install', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    expect(manifest.dependencies['node-pty']).toBeUndefined();
    expect(manifest.optionalDependencies?.['node-pty']).toBeDefined();
  });

  test('a missing native PTY reports recovery instructions on first use', async () => {
    // Isolate the real host from the repository's installed native dependency.
    const directory = mkdtempSync(join(tmpdir(), 'command-stream-no-pty-'));
    try {
      for (const name of [
        'terminal-pty-host.mjs',
        'terminal-pty-host-platform.mjs',
      ]) {
        copyFileSync(
          new URL(`../src/${name}`, import.meta.url),
          join(directory, name)
        );
      }
      await expect(
        spawnTerminalPty(
          process.execPath,
          ['-e', ''],
          {},
          {
            hostPath: join(directory, 'terminal-pty-host.mjs'),
            nodeBinary: 'node',
          }
        )
      ).rejects.toThrow('command-stream: PTY support is unavailable');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
