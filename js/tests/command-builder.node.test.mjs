import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { $, command } from '../src/$.mjs';

const require = createRequire(import.meta.url);
for (const [format, api] of [
  ['ESM', { $, command }],
  ['CommonJS', require('../src/$.cjs')],
  ['core ESM', await import('../src/core.mjs')],
  ['core CommonJS', require('../src/core.cjs')],
]) {
  test(
    `${format} builders share literal argv, presets, selection and sync behavior`,
    { timeout: 10000 },
    async () => {
      const args = ['', "a'b", 'a b', '$HOME; echo injected', '\n'];
      const builder = api.command(process.execPath, [
        '-e',
        'console.log(JSON.stringify(process.argv.slice(1)))',
        ...args,
      ]);
      assert.deepEqual(JSON.parse(await (await builder).text()), args);
      assert.deepEqual(JSON.parse(await builder.sync().text()), args);
      assert.equal(builder.exitCode().sync(), 0);
      assert.equal(await builder.pipe(api.command.exitCode), 0);
      const preset = api.$({ stdin: 'preset', mirror: false }).command;
      assert.equal(
        await (
          await preset(
            process.execPath,
            '-e',
            'process.stdin.pipe(process.stdout)'
          )
        ).text(),
        'preset'
      );
    }
  );
}

for (const execution of ['run', 'sync']) {
  test(
    `${execution}: inherit writes exactly once while ignore discards output`,
    { timeout: 10000 },
    () => {
      const source = `
    const { command } = await import('./js/src/command-builder.mjs');
    const builder = command(process.execPath, '-e', "console.log('visible');console.error('hidden')")
      .stdout('inherit').stderr('ignore').mirror(true);
    const result = await builder.${execution}();
    if (String(result.stdout) !== '' || String(result.stderr) !== '') process.exit(9);
  `;
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', source],
        { encoding: 'utf8' }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, 'visible\n');
      assert.equal(result.stderr, '');
    }
  );
}

test('sync inherits piped stdin from the parent', { timeout: 10000 }, () => {
  const source = `
    const { command } = await import('./js/src/command-builder.mjs');
    const builder = command(process.execPath, '-e', 'process.stdin.pipe(process.stdout)');
    const result = builder.stdin('inherit').sync();
    process.stdout.write(String(result.stdout));
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', source],
    {
      input: 'inherited input',
      encoding: 'utf8',
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'inherited input');
});
