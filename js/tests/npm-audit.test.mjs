import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test.skipIf(process.platform === 'win32')(
  'issue #209: npm audit transport errors must fail the security check',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-error-'));
    try {
      const executable = join(dir, 'npm');
      writeFileSync(
        executable,
        '#!/bin/sh\necho \'{"error":{"code":"EAI_AGAIN","summary":"registry unavailable"}}\'\nexit 1\n'
      );
      chmodSync(executable, 0o755);
      const result = spawnSync(
        process.execPath,
        [resolve('.github/scripts/npm-audit.mjs')],
        {
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
        }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('EAI_AGAIN');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
