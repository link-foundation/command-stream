/**
 * Compile-only tests for the ES module declarations (`types/index.d.ts`).
 *
 * Checked by `npm run check:types`; never executed. Every runtime export is
 * exercised here, and `@ts-expect-error` lines prove misuse is rejected.
 */

import $, {
  $ as named$,
  AnsiUtils,
  ProcessRunner,
  captureTerminal,
  configureAnsi,
  create,
  disableVirtualCommands,
  enableVirtualCommands,
  exec,
  forceCleanupAll,
  getAnsiConfig,
  isPreQuotedPassthroughEnabled,
  isQuoteContextEnabled,
  listCommands,
  literal,
  openTerminal,
  processOutput,
  quote,
  quoteForContext,
  quoteLiteral,
  raw,
  readAsciicast,
  register,
  resetGlobalState,
  run,
  set,
  setPreQuotedPassthroughEnabled,
  setQuoteContextEnabled,
  sh,
  shell,
  spawn,
  unregister,
  unrollTerminalFrames,
  unset,
  type AnsiConfig,
  type CommandError,
  type CommandResult,
  type CommandTag,
  type OutputChunk,
  type ParsedAsciicast,
  type ProcessOptions,
  type ShellSettings,
  type StreamChunk,
  type StreamEmitter,
  type StreamResult,
  type TerminalCaptureResult,
  type TerminalSession,
  type VirtualCommandContext,
  type VirtualCommandHandler,
} from 'command-stream';
import type { ChildProcess } from 'node:child_process';
import { expectType, use, type Equal } from './helpers.cjs';

export async function taggedTemplates(): Promise<void> {
  expectType<Equal<typeof $, typeof named$>>();

  const runner = $`echo ${'hello'} ${42} ${['a', 'b']} ${raw('| cat')}`;
  expectType<Equal<typeof runner, ProcessRunner>>();

  const result = await runner;
  expectType<Equal<typeof result, StreamResult>>();
  expectType<Equal<typeof result.code, number>>();
  expectType<Equal<typeof result.exitCode, number>>();

  // Captured output behaves like a string.
  const text: string | undefined = result.stdout?.trim();
  const lines: string[] | undefined = result.stdout?.split('\n');
  const length: number | undefined = result.stdout?.length;
  const stdinText: string = String(result.stdin);
  expectType<Equal<Awaited<ReturnType<typeof result.text>>, string>>();
  use(text, lines, length, stdinText);

  const withOptions = $({ mirror: false, cwd: '/tmp', stdin: 'data' });
  expectType<Equal<typeof withOptions, CommandTag>>();
  expectType<Equal<ReturnType<typeof withOptions>, ProcessRunner>>();

  const tag = create({ capture: true, env: { PATH: '/bin' } });
  expectType<Equal<ReturnType<typeof tag>, ProcessRunner>>();

  // @ts-expect-error - unknown option
  $({ mirorr: false });
  // @ts-expect-error - stdin must be a mode, string data or a Buffer
  $({ stdin: 42 });
  // @ts-expect-error - killSignal must be a signal name
  $({ killSignal: 'SIGNOPE' });
  // @ts-expect-error - $ is not a plain function of a string
  $('echo hi');
}

export async function entryPoints(): Promise<void> {
  expectType<Equal<Awaited<ReturnType<typeof sh>>, StreamResult>>();
  expectType<Equal<Awaited<ReturnType<typeof exec>>, StreamResult>>();
  expectType<Equal<Awaited<ReturnType<typeof run>>, StreamResult>>();

  await sh('echo hi', { mirror: false });
  await exec('node', ['--version'], { capture: true });
  await run('echo hi');
  await run(['node', '--version'] as const);

  // @ts-expect-error - exec takes an argv array, not a string
  await exec('node', '--version');
  // @ts-expect-error - run takes a string or an argv array
  await run(42);

  const child: ChildProcess = spawn('node', ['--version'], { stdio: 'pipe' });
  const same: typeof spawn = $.spawn;
  const syncResult = spawn.sync('node', ['--version']);
  expectType<Equal<typeof syncResult.status, number | null>>();
  use(child, same);
}

export async function processRunner(runner: ProcessRunner): Promise<void> {
  const quiet = runner.quiet();
  expectType<Equal<typeof quiet, ProcessRunner>>();

  const piped = runner.pipe($`cat`);
  expectType<Equal<typeof piped, ProcessRunner>>();
  // @ts-expect-error - pipe needs a ProcessRunner destination
  runner.pipe('cat');

  expectType<Equal<ReturnType<typeof runner.sync>, StreamResult>>();
  expectType<Equal<ReturnType<typeof runner.async>, Promise<StreamResult>>>();

  const started = runner.start();
  expectType<Equal<typeof started, Promise<StreamResult>>>();
  const startedSync = runner.start({ mode: 'sync' });
  expectType<Equal<typeof startedSync, StreamResult>>();
  const ran = runner.run({ mode: 'sync', capture: false });
  expectType<Equal<typeof ran, StreamResult>>();

  const mapped = await runner.then((result) => result.code);
  expectType<Equal<typeof mapped, number>>();
  const recovered = await runner.catch(() => 'failed' as const);
  expectType<Equal<typeof recovered, StreamResult | 'failed'>>();
  expectType<Equal<Awaited<ReturnType<typeof runner.finally>>, StreamResult>>();

  expectType<Equal<typeof runner.pid, number | undefined>>();
  expectType<Equal<typeof runner.result, CommandResult | null>>();
  const out = await runner.strings.stdout;
  expectType<Equal<typeof out, string>>();
  const buf = await runner.buffers.stderr;
  expectType<Equal<typeof buf, Buffer>>();
  const handle = runner.child;
  if (handle && 'pid' in handle) {
    const pid: number | undefined = handle.pid;
    use(pid);
  }

  runner.kill();
  runner.kill('SIGINT');
  // @ts-expect-error - not a signal name
  runner.kill('SIGWHATEVER');

  // @ts-expect-error - unknown spec mode
  new ProcessRunner({ mode: 'script', command: 'echo' });
  const direct = new ProcessRunner(
    { mode: 'exec', file: 'node', args: ['-v'] },
    { mirror: false }
  );
  use(direct);
}

export async function streaming(runner: ProcessRunner): Promise<void> {
  for await (const chunk of runner.stream()) {
    expectType<Equal<typeof chunk, StreamChunk>>();
    switch (chunk.type) {
      case 'stdout':
      case 'stderr':
        expectType<Equal<typeof chunk.data, Buffer>>();
        break;
      case 'exit':
        expectType<Equal<typeof chunk.code, number>>();
        // @ts-expect-error - exit chunks carry no data
        use(chunk.data);
        break;
    }
  }

  for await (const chunk of runner) {
    expectType<Equal<typeof chunk, StreamChunk>>();
  }
}

export function events(runner: ProcessRunner): void {
  const chained = runner
    .on('stdout', (chunk) => {
      expectType<Equal<typeof chunk, Buffer>>();
    })
    .on('stderr', (chunk) => {
      expectType<Equal<typeof chunk, Buffer>>();
    })
    .on('data', (chunk) => {
      expectType<Equal<typeof chunk, OutputChunk>>();
    })
    .once('end', (result) => {
      expectType<Equal<typeof result, CommandResult>>();
    })
    .on('exit', (code) => {
      expectType<Equal<typeof code, number>>();
    });
  expectType<Equal<typeof chained, ProcessRunner>>();

  const emitter: StreamEmitter = runner;
  const listener = (code: number): void => use(code);
  emitter.on('exit', listener).off('exit', listener);
  runner.emit('exit', 0);

  // @ts-expect-error - unknown event name
  runner.on('close', () => {});
  // @ts-expect-error - exit listeners receive a number
  runner.on('exit', (code: string) => use(code));
  // @ts-expect-error - emitted payload must match the event
  runner.emit('stdout', 'text');
}

export function virtualCommands(): void {
  const greet: VirtualCommandHandler = async ({ args, stdin, cwd }) => {
    expectType<Equal<typeof args, string[]>>();
    expectType<Equal<typeof stdin, string>>();
    use(cwd);
    return { stdout: `hello ${args[0] ?? 'world'}\n`, code: 0 };
  };
  const registry = register('greet', greet);
  expectType<Equal<typeof registry, Map<string, VirtualCommandHandler>>>();

  register('sync-result', () => ({ stderr: 'nope', code: 2 }));
  register('ticker', async function* (context: VirtualCommandContext) {
    for (let i = 0; i < 3; i++) {
      if (context.isCancelled?.()) {
        return;
      }
      yield `tick ${i}\n`;
    }
    yield Buffer.from('done\n');
  });

  // @ts-expect-error - code must be a number
  register('bad-code', async () => ({ code: '1' }));
  // @ts-expect-error - handlers cannot yield numbers
  register('bad-yield', async function* () {
    yield 1;
  });
  // @ts-expect-error - a handler is required
  register('missing');

  expectType<Equal<ReturnType<typeof unregister>, boolean>>();
  expectType<Equal<ReturnType<typeof listCommands>, string[]>>();
  expectType<Equal<ReturnType<typeof enableVirtualCommands>, true>>();
  expectType<Equal<ReturnType<typeof disableVirtualCommands>, false>>();
}

export function quoting(): void {
  expectType<Equal<ReturnType<typeof quote>, string>>();
  const single: string = quoteForContext("it's", 'single');
  // @ts-expect-error - unknown quote context
  quoteForContext('x', 'backtick');
  const literalQuoted: string = quoteLiteral("didn't");
  expectType<Equal<ReturnType<typeof raw>, { raw: string }>>();
  expectType<Equal<ReturnType<typeof literal>, { literal: string }>>();
  const contextEnabled: boolean = setQuoteContextEnabled(null);
  const passthrough: boolean = setPreQuotedPassthroughEnabled(false);
  use(
    single,
    literalQuoted,
    contextEnabled,
    passthrough,
    isQuoteContextEnabled(),
    isPreQuotedPassthroughEnabled()
  );
}

export function shellSettings(): void {
  const settings = set('e');
  expectType<Equal<typeof settings, ShellSettings>>();
  unset('o pipefail');
  // @ts-expect-error - unknown shell option
  set('z');
  const snapshot: ShellSettings = shell.settings();
  shell.errexit(false);
  shell.pipefail();
  const quoteContext: boolean = shell.quoteContext(null);
  use(snapshot, quoteContext);
  resetGlobalState();
  forceCleanupAll();
}

export function ansi(): void {
  const stripped: string = AnsiUtils.stripAll('\u001b[31mred\u001b[0m');
  const cleaned: Buffer = AnsiUtils.cleanForProcessing(Buffer.from('x'));
  const config = configureAnsi({ preserveAnsi: false });
  expectType<Equal<typeof config, AnsiConfig>>();
  expectType<Equal<ReturnType<typeof getAnsiConfig>, AnsiConfig>>();
  const processedBuffer: Buffer = processOutput(Buffer.from('x'));
  const processedText: string = processOutput('x', { preserveAnsi: false });
  // @ts-expect-error - unknown ANSI option
  configureAnsi({ preserveColors: true });
  use(stripped, cleaned, processedBuffer, processedText);
}

export async function terminal(): Promise<void> {
  const capture = await captureTerminal({
    file: 'node',
    args: ['-e', 'console.log(1)'],
    cols: 80,
    interactions: [{ after: /ready/, key: 'ENTER' }, { text: 'q' }],
  });
  expectType<Equal<typeof capture, TerminalCaptureResult>>();
  const transcript: string = capture.transcript;
  const firstLine: string | undefined = capture.frames[0]?.lines[0];

  const session = await openTerminal({ file: 'bash', rows: 24 });
  expectType<Equal<typeof session, TerminalSession>>();
  await session.waitFor('$ ');
  await session.send([{ text: 'exit\n' }]);
  const closed = await session.close({ signal: 'SIGTERM' });
  expectType<Equal<typeof closed, TerminalCaptureResult>>();

  const cast = await readAsciicast('capture.cast');
  expectType<Equal<typeof cast, ParsedAsciicast>>();
  const unrolled: string = unrollTerminalFrames(capture.frames);

  // @ts-expect-error - file is required
  await captureTerminal({ cols: 80 });
  use(transcript, firstLine, unrolled);
}

export function errors(error: unknown): void {
  const commandError = error as CommandError;
  expectType<Equal<typeof commandError.exitCode, number>>();
  expectType<Equal<typeof commandError.stderr, string | undefined>>();
  const options: ProcessOptions = { signal: new AbortController().signal };
  use(options);
}
