import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const probe = fileURLToPath(
  new URL('../../experiments/issue-235/import-probe.mjs', import.meta.url)
);

test(
  'core bundles and executes without compatibility or native terminal inputs',
  { timeout: 10000 },
  async () => {
    const bundle = await build({
      stdin: {
        contents:
          'const { $ } = require("command-stream/core"); console.log($({ mirror: false })`echo bundled-core`.sync().stdout.toString().trim());',
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      metafile: true,
    });
    assert.deepEqual(
      Object.keys(bundle.metafile.inputs).filter((path) =>
        /\/(?:shelljs|execa|zx|bun-shell)\/|\/terminal-|@xterm|@resvg|node-pty|gifenc/.test(
          path
        )
      ),
      []
    );
    const result = spawnSync('node', ['--input-type=commonjs'], {
      input: bundle.outputFiles[0].text,
      encoding: 'utf8',
      timeout: 8000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'bundled-core');
  }
);

for (const mode of ['import', 'require']) {
  test(
    `core ${mode} stays within its cold-load budget`,
    { timeout: 10000 },
    () => {
      const result = spawnSync('node', [probe, 'command-stream/core', mode], {
        encoding: 'utf8',
        timeout: 8000,
      });
      assert.equal(result.status, 0, result.stderr);
      const measurement = JSON.parse(result.stdout);
      console.log(
        `core ${mode}: ${measurement.count} modules, ${measurement.ms.toFixed(1)} ms`
      );
      assert.ok(measurement.count < 100, JSON.stringify(measurement));
      assert.deepEqual(
        measurement.modules.filter((url) =>
          /\/(?:shelljs|execa|zx|bun-shell)\/|\/terminal-|\/(?:development|rust-repl|debugger-view|testing)\.mjs|node_modules\/(?!cross-spawn\/|path-key\/|shebang-command\/|shebang-regex\/|which\/|isexe\/)/.test(
            url
          )
        ),
        []
      );
    }
  );
}

test(
  'core runs tagged commands, sync execution and virtual pipelines',
  { timeout: 10000 },
  async () => {
    const core = await import('command-stream/core');
    assert.equal(core.default, core.$);
    for (const name of ['echo', 'cat', 'pwd', 'cd', 'which']) {
      assert.ok(core.listCommands().includes(name));
    }
    const $ = core.$({ mirror: false });
    const text = 'spaces; "quotes" and $variables';
    assert.equal((await $`echo ${text}`).stdout.trim(), text);
    assert.equal($`echo sync`.sync().stdout.trim(), 'sync');
    core.register('issue235', () => ({ code: 0, stdout: 'shared core\n' }));
    try {
      assert.equal((await $`issue235`).stdout.toString(), 'shared core\n');
      assert.equal(
        (await $`issue235`.pipe($`cat`)).stdout.toString(),
        'shared core\n'
      );
      const runner = new core.ProcessRunner(
        {
          mode: 'exec',
          file: process.execPath,
          args: ['-e', "process.stdout.write('argv')"],
        },
        { mirror: false, stdin: 'ignore' }
      );
      assert.equal((await runner).stdout.toString(), 'argv');
    } finally {
      core.unregister('issue235');
    }
  }
);

test(
  'core ESM, CommonJS, full entry and process-runner share state',
  { timeout: 10000 },
  async () => {
    const core = await import('command-stream/core');
    const cjs = require('command-stream/core');
    assert.equal(typeof cjs, 'function');
    assert.equal(cjs.$, cjs);
    assert.equal(cjs.default, cjs);
    assert.equal(cjs.ProcessRunner, core.ProcessRunner);
    assert.equal(cjs({ mirror: false })`echo cjs`.sync().stdout.trim(), 'cjs');
    assert.equal(core.$.ProcessRunner, undefined);
    const full = await import('command-stream');
    const runner = await import('command-stream/process-runner');
    assert.equal(full.$, core.$);
    assert.equal(full.ProcessRunner, runner.ProcessRunner);
    assert.equal(full.ProcessRunner, core.ProcessRunner);
    assert.equal(full.shell, core.shell);
    assert.equal(full.command, core.command);
    cjs.register('issue235shared', () => ({ code: 0, stdout: 'registered' }));
    try {
      assert.ok(full.listCommands().includes('issue235shared'));
      assert.equal(
        (await full.$({ mirror: false })`issue235shared`).stdout.toString(),
        'registered'
      );
    } finally {
      full.unregister('issue235shared');
    }
  }
);
