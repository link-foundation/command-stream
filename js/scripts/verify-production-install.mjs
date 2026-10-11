// Copied into an isolated consumer by test-production-install.sh. Exercise the
// published exports without repository dependencies or a native PTY binding.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { $, openTerminal } = await import('command-stream');
const require = createRequire(import.meta.url);
const commonjs = require('command-stream');
const { ProcessRunner } = await import('command-stream/process-runner');
assert.equal(commonjs.ProcessRunner, ProcessRunner);

const manifest = require('command-stream/package.json');
for (const section of [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]) {
  assert.equal(manifest[section]?.shelljs, undefined);
  assert.equal(manifest[section]?.['@types/shelljs'], undefined);
}
for (const name of [
  'shelljs',
  '@types/shelljs',
  'fast-glob',
  'micromatch',
  'braces',
]) {
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
}

const shelljs = (await import('command-stream/shelljs')).default;
assert.equal(shelljs, $.shelljs);
assert.equal(shelljs, commonjs.shelljs);
assert.equal(shelljs, require('command-stream/shelljs'));
const plugin = require('command-stream/shelljs/plugin');
assert.equal(plugin, (await import('command-stream/shelljs/plugin')).default);
plugin.register('installedPluginTest', () => 'plugin-ok');
assert.equal(shelljs.installedPluginTest().stdout, 'plugin-ok');
delete shelljs.installedPluginTest;
const fixture = mkdtempSync(
  join(tmpdir(), 'command-stream-installed-shelljs-')
);
try {
  shelljs.config.silent = true;
  shelljs.ShellString('b\na\na\n').to(join(fixture, 'a.txt'));
  writeFileSync(join(fixture, 'b.txt'), 'c\n');
  assert.equal(
    shelljs.cat(join(fixture, '*.txt')).sort().uniq().stdout,
    'a\nb\nc\n'
  );
  assert.equal(
    shelljs.cmd(
      process.execPath,
      '-e',
      'console.log(process.argv[1])',
      'two words'
    ).stdout,
    'two words\n'
  );
  assert.equal(shelljs.cmd('command-stream-missing-program').code, 127);
  assert.equal(readFileSync(join(fixture, 'a.txt'), 'utf8'), 'b\na\na\n');
} finally {
  shelljs.config.reset();
  rmSync(fixture, { recursive: true, force: true });
}

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
