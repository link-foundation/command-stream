// `#!/usr/bin/env command-stream` scripts (issue #26): the kernel resolves the
// `command-stream` bin from PATH, the CLI runs the script with the zx globals
// and passes the remaining arguments through. Windows has no shebangs (npm's
// .cmd shim covers it), so this runs on POSIX only.

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/zx/cli.mjs', import.meta.url));
const IS_WIN = process.platform === 'win32';

describe('#!/usr/bin/env command-stream', { skip: IS_WIN }, () => {
  let dir;
  let env;

  before(() => {
    dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cs-shebang-'))
    );
    // What `npm install -g command-stream` puts on PATH.
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.symlinkSync(CLI, path.join(dir, 'bin', 'command-stream'));
    env = {
      ...process.env,
      PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`,
    };
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const script = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/usr/bin/env command-stream\n${body}`);
    fs.chmodSync(file, 0o755);
    return file;
  };

  test('runs the script with the zx globals and its arguments', () => {
    const file = script(
      'deploy.mjs',
      [
        "const out = await $`echo ${argv._.join(' ')}`;",
        'cd(os.tmpdir());',
        'echo(out.stdout.trim(), argv.env, typeof fs.readFile, typeof glob);',
        '',
      ].join('\n')
    );
    const { status, stdout, stderr } = spawnSync(
      file,
      ['one two', '--env=prod'],
      { cwd: dir, env, encoding: 'utf8' }
    );
    assert.equal(stderr, '');
    assert.equal(status, 0);
    assert.equal(stdout, 'one two prod function function\n');
  });

  // Like zx, an uncaught failure prints the ProcessOutput and exits with 1.
  test('fails the script when a command fails', () => {
    const file = script('fail.mjs', 'await $`exit 7`;\n');
    const { status, stderr } = spawnSync(file, [], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    assert.equal(status, 1);
    assert.match(stderr, /exit code: 7/i);
  });
});
