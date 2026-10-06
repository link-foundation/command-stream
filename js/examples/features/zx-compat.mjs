// zx compatibility mode: `$.zx` (or `command-stream/zx`) runs scripts written
// for google/zx unchanged - same quoting, ProcessPromise/ProcessOutput, pipes,
// `within`, `nothrow` and the rest of the zx surface.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $ } from '../../src/$.mjs';
import { $ as zx$, within, ProcessOutput } from '../../src/zx/index.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'zx-compat', title: 'zx compatibility mode' },
  async ({ record }) => {
    record('$.zx is the zx $', $.zx === zx$);

    // Interpolated values are quoted the zx way, so spaces survive.
    const words = 'hello world';
    const greeting = await $.zx`echo ${words}`;
    record('interpolation', greeting.stdout);
    record('ProcessOutput', greeting instanceof ProcessOutput);

    // Failing commands reject with a ProcessOutput, unless `nothrow` is set.
    try {
      await $.zx`exit 2`;
    } catch (error) {
      record('rejected exit code', error.exitCode);
    }
    record(
      'nothrow exit code',
      (await $.zx({ nothrow: true })`exit 3`).exitCode
    );

    record('pipe', (await $.zx`printf 'b\na\n'`.pipe($.zx`sort`)).lines());

    // `within` scopes settings such as the working directory.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zx-')));
    try {
      const inside = await within(async () => {
        $.zx.cwd = dir;
        return (await $.zx`pwd`).stdout.trim() === dir;
      });
      record('within cwd', inside);
      record('cwd restored', $.zx.cwd === undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
