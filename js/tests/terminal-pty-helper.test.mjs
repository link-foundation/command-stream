import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSpawnHelper } from '../src/terminal-pty-host-platform.mjs';

describe('node-pty macOS spawn-helper permissions', () => {
  test.skipIf(process.platform === 'win32')(
    'repairs a packaged non-executable helper before spawning it',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'pty-helper-'));
      try {
        const helper = join(root, 'spawn-helper');
        const source = '#!/bin/sh\nprintf helper-ready\n';
        writeFileSync(helper, source);
        chmodSync(helper, 0o644);
        prepareSpawnHelper(helper, 'darwin');
        const child = spawnSync(helper, [], {
          encoding: 'utf8',
          timeout: 1000,
        });
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(0);
        expect(child.stdout).toBe('helper-ready');
        expect(readFileSync(helper, 'utf8')).toBe(source);
        expect(statSync(helper).mode & 0o777).toBe(0o755);

        chmodSync(helper, 0o750);
        prepareSpawnHelper(helper, 'darwin');
        expect(statSync(helper).mode & 0o777).toBe(0o750);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  test('does not access a helper on other platforms', () => {
    for (const name of ['linux', 'win32']) {
      expect(() =>
        prepareSpawnHelper('/missing/spawn-helper', name)
      ).not.toThrow();
    }
  });
});
