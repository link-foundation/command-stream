// command-stream/bun on Deno: Deno's node:fs differs from Node's in ways
// the shell's builtins depend on (js/src/bun-shell/fs.mjs). Without the shim,
// `ls` failed with "unknown error 0" and `rm dir` deleted an empty directory.
// The whole corpus runs on Deno in .github/workflows/bun-shell.yml; this
// pins the two regressions down locally when `deno` is installed.

import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const deno = Bun.which('deno');
const entry = new URL('../src/bun.mjs', import.meta.url).href;

test.skipIf(!deno)('ls and rm behave as on Node.js under Deno', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bun-shell-deno-'));
  try {
    const script = `
      import { $ } from ${JSON.stringify(entry)};
      await $\`mkdir -p empty full/sub && touch full/a\`;
      const ls = await $\`ls full\`.nothrow().quiet();
      const rm = await $\`rm empty\`.nothrow().quiet();
      const exists = await $.file('empty').exists();
      console.log(JSON.stringify({
        ls: ls.text().split('\\n').filter(Boolean).sort(),
        lsErr: ls.stderr.toString(),
        rmErr: rm.stderr.toString(),
        rmCode: rm.exitCode,
        exists,
      }));
    `;
    const run = spawnSync(deno, ['eval', '--ext=mjs', script], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(run.stderr).toBe('');
    const result = JSON.parse(run.stdout);
    expect(result.ls).toEqual(['a', 'sub']);
    expect(result.lsErr).toBe('');
    expect(result.rmCode).toBe(1);
    expect(result.rmErr).toBe('rm: empty: Is a directory\n');
    expect(result.exists).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
