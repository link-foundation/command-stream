/**
 * Compile-only tests for the ES module declarations (`types/index.d.ts`).
 *
 * Checked by `npm run check:types`; never executed. Every runtime export is
 * exercised here, and `@ts-expect-error` lines prove misuse is rejected.
 */

import $, {
  $ as named$,
  AnsiUtils,
  CommandBuilder,
  command,
  fy,
  StreamPipeline,
  stream,
  merge,
  TerminalBuffer,
  extend,
  inherit,
  compose,
  install,
  marketplace,
  dev,
  startRepl,
  startRustRepl,
  PipelineDebugger,
  testing,
  ProcessRunner,
  captureTerminal,
  configureAnsi,
  create,
  disableVirtualCommands,
  enableVirtualCommands,
  exec,
  execa,
  execaCompat,
  execaSync,
  execaNode,
  execaCommand,
  execaCommandSync,
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
  shelljs,
  spawn,
  spawnDetached,
  unregister,
  unrollTerminalFrames,
  unset,
  type AnsiConfig,
  type CommandError,
  type CommandResult,
  type ConfiguredCommandTag,
  type DetachedProcess,
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
  expectType<Equal<typeof result.signal, NodeJS.Signals | null>>();
  expectType<Equal<typeof result.timedOut, boolean>>();

  // Captured output behaves like a string.
  const text: string | undefined = result.stdout?.trim();
  const lines: string[] | undefined = result.stdout?.split('\n');
  const length: number | undefined = result.stdout?.length;
  const stdinText: string = String(result.stdin);
  expectType<Equal<Awaited<ReturnType<typeof result.text>>, string>>();
  use(text, lines, length, stdinText);

  const withOptions = $({
    mirror: false,
    cwd: '/tmp',
    stdin: 'data',
    preferLocal: true,
    timeout: 5000,
    loginShell: false,
  });
  expectType<Equal<typeof withOptions, ConfiguredCommandTag>>();
  expectType<Equal<ReturnType<typeof withOptions>, ProcessRunner>>();

  const tag = create({ capture: true, env: { PATH: '/bin' } });
  expectType<Equal<ReturnType<typeof tag>, ProcessRunner>>();

  // @ts-expect-error - unknown option
  $({ mirorr: false });
  // @ts-expect-error - stdin must be a mode, string data or a Buffer
  $({ stdin: 42 });
  // @ts-expect-error - killSignal must be a signal name
  $({ killSignal: 'SIGNOPE' });
  // @ts-expect-error - timeout is a number of milliseconds
  $({ timeout: '5s' });
  // @ts-expect-error - preferLocal accepts paths or a boolean
  $({ preferLocal: 42 });
  // @ts-expect-error - $ is not a plain function of a string
  $('echo hi');
}

export async function entryPoints(): Promise<void> {
  use(execa, execaCompat, execaSync, execaNode, execaCommand, execaCommandSync);
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

  // Fire and forget (issue #232).
  expectType<
    Equal<Awaited<ReturnType<typeof spawnDetached>>, DetachedProcess>
  >();
  const detached: number = (await spawnDetached('sleep 1', { cwd: '/tmp' }))
    .pid;
  await spawnDetached(['sleep', '1'] as const);
  await spawnDetached({ file: 'sleep', args: ['1'] }, { env: {} });
  const detachedResult = await $({ detached: true })`sleep 1`;
  const detachedPid: number | undefined = detachedResult.pid;
  const flagged: boolean | undefined = detachedResult.detached;
  const fromRunner: DetachedProcess = await $`sleep 1`.spawnDetached();
  use(detached, detachedPid, flagged, fromRunner);
  // @ts-expect-error - spawnDetached needs a command
  await spawnDetached(42);
  // @ts-expect-error - detached is a boolean
  $({ detached: 'yes' });

  const child: ChildProcess = spawn('node', ['--version'], { stdio: 'pipe' });
  const same: typeof spawn = $.spawn;
  const syncResult = spawn.sync('node', ['--version']);
  expectType<Equal<typeof syncResult.status, number | null>>();
  use(child, same);

  // `$.zx` is the zx-compatible `$` of `command-stream/zx`.
  const zxOutput = await $.zx({ nothrow: true })`echo ${'hi'}`;
  expectType<Equal<typeof zxOutput.exitCode, number | null>>();
  const zxText: string = zxOutput.stdout;
  const zxSync = $.zx.sync`echo hi`;
  expectType<Equal<typeof zxSync.ok, boolean>>();
  // @ts-expect-error - `$.zx` is read-only
  $.zx = $.zx;
  use(zxText);
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
        expectType<Equal<typeof chunk.signal, NodeJS.Signals | null>>();
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
      expectType<Equal<typeof result.signal, NodeJS.Signals | null>>();
    })
    .on('exit', (code, signal) => {
      expectType<Equal<typeof code, number>>();
      expectType<Equal<typeof signal, NodeJS.Signals | null | undefined>>();
    });
  expectType<Equal<typeof chained, ProcessRunner>>();

  const emitter: StreamEmitter = runner;
  const listener = (code: number): void => use(code);
  emitter.on('exit', listener).off('exit', listener);
  runner.emit('exit', 0);
  runner.emit('exit', 143, 'SIGTERM');

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
  session.onChange((change) => {
    const rows: number = change.rows;
    void rows;
  });
  session.frameStream({ capacity: 8 });
  session.changes({ signal: new AbortController().signal });
  session.text({ color: true });
  await session.waitFor('$ ');
  await session.send([{ text: 'exit\n' }]);
  const closed = await session.close({ signal: 'SIGTERM' });
  expectType<Equal<typeof closed, TerminalCaptureResult>>();

  const cast = await readAsciicast('capture.cast');
  expectType<Equal<typeof cast, ParsedAsciicast>>();
  const unrolled: string = unrollTerminalFrames(capture.frames);

  // @ts-expect-error - file is required
  await captureTerminal({ cols: 80 });
  await captureTerminal({
    file: 'node',
    env: { ...process.env, ANTHROPIC_API_KEY: undefined },
    artifactDirectory: 'artifacts',
    artifacts: ['transcript', 'snapshot', 'gif'],
  });
  // @ts-expect-error - unknown artifact name
  await captureTerminal({ file: 'node', artifacts: ['video'] });
  use(transcript, firstLine, unrolled);
}

export function errors(error: unknown): void {
  const commandError = error as CommandError;
  expectType<Equal<typeof commandError.exitCode, number>>();
  expectType<Equal<typeof commandError.stderr, string | undefined>>();
  const options: ProcessOptions = { signal: new AbortController().signal };
  use(options);
}

const shelljsOutput: string = shelljs.echo('typed').stdout;
void shelljsOutput;

export async function advancedFeatures(): Promise<void> {
  const result = await $.command('printf', '%s', 'literal ; text');
  const status: number = await $.command('false')
    .pipe(command.stdout('inherit'), command.exitCode)
    .run();
  const data: number[] = await $.command('printf', '1\\n2\\n')
    .stream()
    .map(Number)
    .toArray();
  const timed: number[][] = await stream(data).batch(10, 500).toArray();
  const windows: string[][] = await $.command('echo', 'typed')
    .stream()
    .slidingWindow(2)
    .toArray();
  void timed;
  void windows;
  const stats = await stream(data).analyze({
    responseTime: (x) => x,
    errorRate: (x) => x > 1,
  });
  const generator = $.create('typed', async function* () {
    yield 'hello';
  });
  extend('typed', (context, next) => next(context));
  const installed = await install('./package.mjs');
  await installed.reload();
  installed.uninstall();
  const controller = dev({ entry: null, packages: [installed] });
  controller.repl?.displayPrompt();
  const rustController = dev({ language: 'rust', entry: 'Cargo.toml' });
  await rustController.repl?.done;
  await rustController.close();
  expectType<Equal<typeof $.startRustRepl, typeof startRustRepl>>();
  const rustRepl = await startRustRepl({ cratePath: './rust' });
  await rustRepl.close();
  // @ts-expect-error supported languages are explicit
  dev({ language: 'python' });
  await controller.ready;
  await controller.close();
  const terminal = new TerminalBuffer();
  const delta = terminal.changes({
    capacity: 8,
    signal: new AbortController().signal,
  });
  void delta;
  await terminal.write('hello');
  terminal.dispose();
  const debug = new PipelineDebugger();
  debug.stage('source', data);
  debug.profile();
  use(
    result,
    status,
    data,
    stats,
    generator,
    CommandBuilder,
    StreamPipeline,
    fy('echo hello'),
    merge(data),
    inherit,
    compose,
    marketplace,
    startRepl,
    testing
  );
  // @ts-expect-error arguments cannot be objects
  command('echo', {});
  // @ts-expect-error stdio modes are checked
  command.stdout('typo');
  // @ts-expect-error command names must be strings when a handler is supplied
  $.create(null, () => ({ code: 0 }));
  // @ts-expect-error command handlers must be callable
  $.create('invalid', { stdout: 'hello' });
  // @ts-expect-error middleware receives context and a callable next handler
  $.extend('typed', (_context, next: string) => next);
  // @ts-expect-error composition accepts handlers rather than command names
  $.compose('typed');
}
