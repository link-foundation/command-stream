/**
 * Compile-only tests for the CommonJS declarations (`types/index.d.cts`).
 */

import $ = require('command-stream');
import helpers = require('./helpers.cjs');

type Equal<A, B> = helpers.Equal<A, B>;
const { expectType, use } = helpers;

export async function commonJs(): Promise<void> {
  const runner: $.ProcessRunner = $`echo hi`;
  const result = await runner;
  expectType<Equal<typeof result, $.StreamResult>>();

  // The module is the `$` function with every named export attached.
  expectType<Equal<typeof $.$, typeof $>>();
  expectType<Equal<typeof $.default, typeof $>>();
  const quiet: $.CommandTag = $({ mirror: false, preferLocal: ['./local'] });
  const created: $.CommandTag = $.create({ capture: true });
  const direct = new $.ProcessRunner({ mode: 'shell', command: 'true' });
  const shResult: Promise<$.StreamResult> = $.sh('echo hi');
  const registry = $.register('noop', async () => ({}));
  expectType<Equal<typeof registry, Map<string, $.VirtualCommandHandler>>>();
  const settings: $.ShellSettings = $.shell.settings();
  const quoted: string = $.quote('a b');

  // @ts-expect-error - not an export
  $.notAnExport();
  // @ts-expect-error - options are type checked
  $({ capture: 'yes' });

  use(quiet, created, direct, shResult, settings, quoted);
}

import bun = require('command-stream/bun');
import shelljs = require('command-stream/shelljs');

export function commonJsShelljs(): void {
  const output: string = shelljs.head({ '-n': 2 }, ['file.txt']).stdout;
  const code: number = $.shelljs.cat('file.txt').code;
  const exists: boolean = shelljs.test('-f', 'file.txt');
  const errorCode: number | null = $.shelljs.errorCode();
  const error: string | null = shelljs.error();
  const temporaryDirectory: string = shelljs.tempdir();
  const noArguments = () => shelljs.cmd('git');
  use(output, code, exists, errorCode, error, temporaryDirectory, noArguments);
}

export async function commonJsBun(): Promise<void> {
  expectType<Equal<typeof bun.$, bun.BunShell>>();
  expectType<Equal<typeof bun.default, bun.BunShell>>();
  expectType<Equal<typeof $.bun, bun.BunShell>>();
  const text: string = await bun.$`echo hi`.text();
  use(text);
}

export async function commonJsAdvanced(): Promise<void> {
  const code: number = await $.command('node', '-e', 'process.exit(0)')
    .pipe($.command.stdout('ignore'), $.command.exitCode)
    .run();
  const values: number[] = await $.stream([1, 2])
    .map((value) => value * 2)
    .toArray();
  const terminal = new $.TerminalBuffer({ cols: 20, rows: 4 });
  terminal.dispose();
  const debugger_ = new $.PipelineDebugger();
  const repl: $.RustReplController = await $.startRustRepl({
    cratePath: './rust',
  });
  await repl.close();
  const watcher = $.dev({ language: 'rust', entry: 'Cargo.toml' });
  await watcher.close();
  use(code, values, debugger_);
}
