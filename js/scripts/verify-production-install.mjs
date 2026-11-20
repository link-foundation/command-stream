// Copied into an isolated consumer by test-production-install.sh. Exercise the
// published exports without repository dependencies or a native PTY binding.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { $, openTerminal, TerminalBuffer } = await import('command-stream');
const { writeTerminalArtifacts } = await import(
  new URL('./terminal-artifacts.mjs', import.meta.resolve('command-stream'))
);
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
assert.equal((await $(options)`echo ok`).stdout.toString().trim(), 'ok');
assert.equal(
  (await $(options)`printf core-install-ok`).stdout.toString(),
  'core-install-ok'
);
assert.equal(
  commonjs(options)`printf cjs-install-ok`.sync().stdout.toString(),
  'cjs-install-ok'
);

const terminalPeers = ['@xterm/headless', '@resvg/resvg-js', 'gifenc'];
for (const name of terminalPeers) {
  assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true);
}
const packageRequire = createRequire(require.resolve('command-stream'));
for (const name of terminalPeers) {
  assert.throws(() => packageRequire.resolve(name), {
    code: 'MODULE_NOT_FOUND',
  });
}
if (process.argv[2] === 'local') {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  for (const path of Object.keys(lock.packages)) {
    assert.doesNotMatch(
      path,
      /(?:^|\/)node_modules\/(?:@xterm\/headless|@resvg\/resvg-js[^/]*|gifenc)$/
    );
  }
}
assert.throws(
  () => new TerminalBuffer(),
  /TerminalBuffer.*npm install @xterm\/headless/
);
await assert.rejects(
  openTerminal({ file: process.execPath, args: ['-e', ''] }),
  /Terminal capture.*npm install @xterm\/headless/
);
const artifactDirectory = mkdtempSync(
  join(tmpdir(), 'command-stream-installed-artifacts-')
);
try {
  const artifacts = {
    directory: artifactDirectory,
    frames: [],
    transcript: 'terminal output',
    asciicast: { header: { width: 2, height: 2 }, events: [] },
  };
  await writeTerminalArtifacts({ ...artifacts, artifacts: ['snapshot'] });
  assert.match(
    readFileSync(join(artifactDirectory, 'snapshot.svg'), 'utf8'),
    /<svg /
  );
  await assert.rejects(
    writeTerminalArtifacts({ ...artifacts, artifacts: ['gif'] }),
    /GIF terminal artifacts.*npm install @resvg\/resvg-js/
  );
} finally {
  rmSync(artifactDirectory, { recursive: true, force: true });
}

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
