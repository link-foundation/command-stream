// Copied into an isolated consumer by test-production-install.sh. Exercise the
// published exports without repository dependencies or a native PTY binding.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { $, openTerminal } = await import('command-stream');
const require = createRequire(import.meta.url);
const commonjs = require('command-stream');
const { ProcessRunner } = await import('command-stream/process-runner');
assert.equal(commonjs.ProcessRunner, ProcessRunner);

const options = { mirror: false, capture: true, stdin: 'ignore' };
assert.equal(
  (await $(options)`printf core-install-ok`).stdout.toString(),
  'core-install-ok'
);
assert.equal(
  commonjs(options)`printf cjs-install-ok`.sync().stdout.toString(),
  'cjs-install-ok'
);

const args = ['path with spaces', 'literal;$(echo unwanted)'];
const result = await new ProcessRunner(
  {
    mode: 'exec',
    file: process.execPath,
    args: [
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      ...args,
    ],
  },
  options
);
assert.equal(result.code, 0);
assert.deepEqual(JSON.parse(result.stdout.toString()), args);
assert.equal(
  require('command-stream/process-runner').ProcessRunner,
  ProcessRunner
);

await assert.rejects(
  openTerminal({ file: process.execPath, args: ['-e', ''] }),
  /command-stream: PTY support is unavailable/
);
