import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $, command, CommandBuilder, create, sh } from '../src/$.mjs';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

beforeEach(beforeTestCleanup);
afterEach(afterTestCleanup);
const argvScript = 'console.log(JSON.stringify(process.argv.slice(1)))';
const readInput = 'process.stdin.pipe(process.stdout)';
const node = (...args) => command(process.execPath, '-e', ...args);

describe('command builder API styles', () => {
  test('fluent configuration preserves immutable reusable descriptions', async () => {
    const base = node(argvScript).arg('a b', '', 42, true, 4n);
    const configured = base
      .stdout('pipe')
      .stderr('ignore')
      .capture()
      .mirror(false);
    expect(base.args).toEqual(['-e', argvScript, 'a b', '', '42', 'true', '4']);
    expect(base.options.stderr).toBeUndefined();
    expect(configured).toBeInstanceOf(CommandBuilder);
    expect(Object.isFrozen(configured)).toBe(true);
    expect(JSON.parse(await (await configured).text())).toEqual([
      'a b',
      '',
      '42',
      'true',
      '4',
    ]);
    expect(await (await configured.run()).text()).toBe(
      await (await base).text()
    );
  });

  test('argv array and constructor styles accept the same options', async () => {
    const args = ['-e', argvScript, '', 'a b'];
    const builder = command(process.execPath, args, { stderr: 'ignore' });
    args.push('late mutation');
    expect(builder.args).toEqual(['-e', argvScript, '', 'a b']);
    expect(await (await builder).text()).toBe(
      await (
        await new CommandBuilder(
          process.execPath,
          builder.args,
          builder.options
        )
      ).text()
    );
    expect(command('echo', 42).args).toEqual(['42']);
    expect(command('echo', []).args).toEqual([]);
    expect(
      command.with({ env: { BUILDER_VALUE: 'preset' } })('echo', []).options.env
        .BUILDER_VALUE
    ).toBe('preset');
  });

  test('functional transforms and fluent methods select the same exit code', async () => {
    const base = node('process.exit(7)');
    const functional = base.pipe(
      command.stdout('ignore'),
      command.stderr('ignore'),
      command.capture(false),
      command.mirror(false),
      command.exitCode
    );
    expect(await functional.run()).toBe(7);
    expect(base.stdout('ignore').stderr('ignore').exitCode().sync()).toBe(7);
    expect((await base).code).toBe(7);
  });

  test('each option style merges env and execution overrides without mutation', async () => {
    const env = { ...process.env, BUILDER_A: 'a', BUILDER_DROP: 'remove' };
    const builder = node(
      'console.log(JSON.stringify([process.env.BUILDER_A, process.env.BUILDER_B, process.env.BUILDER_DROP]))'
    )
      .env(env)
      .pipe(command.env({ BUILDER_B: 'b' }));
    env.BUILDER_A = 'mutated';
    const result = await builder.run({
      env: { BUILDER_DROP: undefined, BUILDER_B: 'override' },
    });
    expect(JSON.parse(await result.text())).toEqual(['a', 'override', null]);
    expect(JSON.parse(await (await builder).text())).toEqual([
      'a',
      'b',
      'remove',
    ]);
  });

  test('configured factories and tagged presets retain builder helpers', async () => {
    for (const factory of [
      command.with({ stdin: 'factory' }),
      create({ stdin: 'factory' }).command,
      $({ stdin: 'factory' }).command,
    ]) {
      const builder = factory(process.execPath, ['-e', readInput]);
      expect(await (await builder).text()).toBe('factory');
      expect(
        await builder
          .pipe(factory.stdin('transform'))
          .run()
          .then((result) => result.text())
      ).toBe('transform');
      expect(
        await factory
          .with({ stdin: 'nested' })(process.execPath, '-e', readInput)
          .run()
          .then((result) => result.text())
      ).toBe('nested');
    }
  });

  test('factory defaults snapshot caller-owned environment objects', () => {
    const env = { BUILDER_VALUE: 'before' };
    const defaults = { env, mirror: false };
    const preset = command.with(defaults);
    env.BUILDER_VALUE = 'after';
    defaults.mirror = true;
    expect(preset('echo').options.env.BUILDER_VALUE).toBe('before');
    expect(preset('echo').options.mirror).toBe(false);
  });

  test('stdin, cwd and run options work through fluent and functional styles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'command-builder-'));
    try {
      const builder = node(
        'console.log(process.cwd()); process.stdin.pipe(process.stdout)'
      )
        .cwd(dir)
        .stdin(Buffer.from('input'))
        .pipe(command.capture(), command.mirror(false));
      const result = await builder.run();
      expect(await result.text()).toBe(`${realpathSync(dir)}\ninput`);
      expect(await (await builder.run({ stdin: 'override' })).text()).toBe(
        `${realpathSync(dir)}\noverride`
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the exact issue example inherits stdout and returns an exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'command-builder-cat-'));
    try {
      const file = join(dir, 'some file.txt');
      writeFileSync(file, 'builder example\n');
      expect(
        await $.command('cat', file)
          .pipe($.command.stdout('inherit'), $.command.exitCode)
          .run()
      ).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('runner retains events and real process pipelines', async () => {
    const source = node("process.stdout.write('pipeline')").runner();
    let output = '';
    source.on('stdout', (chunk) => {
      output += chunk;
    });
    const destination = node(readInput).runner();
    const result = await source.pipe(destination);
    expect(output).toBe('pipeline');
    expect(await result.text()).toBe('pipeline');
  });

  test('streaming retains raw output and fluent line processing', async () => {
    const builder = node("process.stdout.write('first\\nsecond\\n')").capture(
      false
    );
    expect(
      await builder
        .stream()
        .map((line) => line.toUpperCase())
        .toArray()
    ).toEqual(['FIRST', 'SECOND']);
  });

  test('run overrides support timeout and cancellation', async () => {
    const builder = node('setInterval(() => {}, 1000)');
    expect((await builder.run({ timeout: 100 })).timedOut).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect((await builder.run({ signal: controller.signal })).code).not.toBe(0);
  }, 5000);
});

describe('command builder safety and rendering', () => {
  test('literal argv stays literal with shell parsing and virtual commands enabled', async () => {
    const args = [
      '',
      'a b',
      "a'b",
      '"quoted"',
      '\n',
      '$HOME',
      '$(echo injected)',
      '`echo injected`',
      '*',
      '; exit 9',
      '&&',
      '|',
    ];
    const builder = node(argvScript).arg(...args);
    expect(JSON.parse(await (await builder).text())).toEqual(args);
    expect(JSON.parse(await builder.sync().text())).toEqual(args);
    expect(builder.cmd).toBe(builder.file);
    expect(builder.buildCommand()).toBe(String(builder));
    if (process.platform !== 'win32') {
      expect(await (await sh(String(builder), { mirror: false })).text()).toBe(
        await (await builder).text()
      );
    }
  });

  test('quotes executable paths as well as arguments', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "builder ' executable "));
    try {
      const executable = join(dir, "test ' $HOME");
      writeFileSync(executable, '#!/bin/sh\nprintf "%s" "$1"\n', {
        mode: 0o755,
      });
      const builder = command(executable, 'literal ; $HOME');
      expect(await (await builder).text()).toBe('literal ; $HOME');
      expect(await (await sh(String(builder), { mirror: false })).text()).toBe(
        'literal ; $HOME'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects invalid argv and stdio modes before spawning', () => {
    for (const file of ['', '\0', null, 12]) {
      expect(() => command(file)).toThrow(TypeError);
    }
    for (const arg of ['\0', null, undefined, {}, ['nested']]) {
      expect(() => node(argvScript).arg(arg)).toThrow(TypeError);
    }
    expect(() => command('echo', ['ok', '\0'])).toThrow(TypeError);
    expect(() => command('echo').with({ stdout: 'invalid' })).toThrow(
      TypeError
    );
    expect(() => command('echo').stderr('invalid')).toThrow(TypeError);
    expect(() => command.stdout('invalid')).toThrow(TypeError);
    expect(() => command('echo').pipe(() => null)).toThrow(TypeError);
  });
});
