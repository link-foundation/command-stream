import { describe, test, expect } from 'bun:test';
import * as api from '../src/$.mjs';

describe('issue 34 exact-argv builder', () => {
  test('is lazy and preserves every argument literally', async () => {
    expect(typeof api.$.command).toBe('function');
    const args = ['', 'a b', '$(echo injected)', "a'b", '\n', '; exit 9'];
    const builder = api.$.command(
      process.execPath,
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      ...args
    );
    expect(builder.file).toBe(process.execPath);
    const result = await builder.run();
    expect(JSON.parse(await result.text())).toEqual(args);
  });

  test('supports the issue example transforms and reusable specifications', async () => {
    expect(typeof api.$.command).toBe('function');
    const builder = api.$.command(
      process.execPath,
      '-e',
      'process.exit(7)'
    ).pipe(api.$.command.stdout('ignore'), api.$.command.exitCode);
    expect(await builder.run()).toBe(7);
    expect(await builder.run()).toBe(7);
  });

  test('ignored stdout is neither captured nor emitted', async () => {
    const runner = api
      .command(
        process.execPath,
        '-e',
        "console.log('ignored'); console.error('kept')"
      )
      .pipe(api.command.stdout('ignore'))
      .runner();
    let output = '';
    runner.on('stdout', (chunk) => {
      output += chunk;
    });
    const result = await runner;
    expect(output).toBe('');
    expect(await result.text()).toBe('');
    expect(String(result.stderr)).toContain('kept');
  });

  test('renders a runnable POSIX string with empty and hostile arguments', async () => {
    if (process.platform === 'win32') {
      return;
    }
    expect(typeof api.$.command).toBe('function');
    const builder = api.$.command(
      process.execPath,
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      '',
      "a'b",
      '$HOME'
    );
    expect(
      await (await api.sh(String(builder), { mirror: false })).text()
    ).toBe(await (await builder.run()).text());
  });
});

describe('issue 1 shell-to-module translator', () => {
  test('embeds shell source as data in a runnable module', () => {
    expect(typeof api.fy).toBe('function');
    const source = 'echo "${HOME}"; printf "%s" "`echo ok`"';
    const module = api.fy(source);
    expect(module).toContain('command-stream');
    expect(module).toContain(JSON.stringify(source));
  });
});
