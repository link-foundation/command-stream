/**
 * TypeScript declarations for the command-stream API.
 *
 * Both entry points re-export these: `index.d.ts` for `import` and
 * `index.d.cts` for `require`. This file is a CommonJS declaration file so
 * that both can load it on every TypeScript version (a CommonJS declaration
 * cannot import an ES module one before TypeScript 5.8).
 *
 * Every runtime export of `src/$.mjs` is declared here, and
 * `tests/typescript-declarations.test.mjs` fails when the runtime and the
 * declarations drift apart. Type-level behaviour is exercised by
 * `tests/types/*.ts`, which `npm run check:types` compiles in strict mode.
 */

/// <reference types="node" />

import type {
  ChildProcess,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Stdio mode keywords accepted by the `stdin` option. */
export type StdinMode = 'inherit' | 'ignore' | 'pipe';

/**
 * Value of the `stdin` option: a stdio mode keyword, or data (a string that
 * is not a mode keyword, or a Buffer) written to the command's stdin.
 */
export type StdinOption = StdinMode | (string & {}) | Buffer;

/** Signal name accepted by `kill()` and the `killSignal` option. */
export type KillSignal = NodeJS.Signals;

/** Options shared by `$`, `create`, `sh`, `exec`, `run` and `ProcessRunner`. */
export interface ProcessOptions {
  /** Write output live to the parent's stdout/stderr. Default: `true`. */
  mirror?: boolean;
  /** Collect output into the result. Default: `true`. */
  capture?: boolean;
  /** Stdin mode or input data. Default: `'inherit'`. */
  stdin?: StdinOption;
  /** Working directory of the command. */
  cwd?: string;
  /** Environment of the command (replaces `process.env`, not merged). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Pass the TTY through to the command when stdin/stdout/stderr are TTYs. */
  interactive?: boolean;
  /** Let the built-in parser handle `&&`, `||`, `;` and subshells. Default: `true`. */
  shellOperators?: boolean;
  /** Signal used by `kill()` without an argument and by `signal` aborts. Default: `'SIGTERM'`. */
  killSignal?: KillSignal;
  /** Milliseconds to wait before escalating to SIGKILL. Default: `100`. */
  killGrace?: number;
  /** Milliseconds output pumps may keep draining after the process exits. Default: `100`. */
  exitPumpGrace?: number;
  /** Aborting this signal kills the command. */
  signal?: AbortSignal;
  /** ANSI handling for emitted `stdout`/`stderr`/`data` events. */
  ansi?: Partial<AnsiConfig>;
  /** Set to `false` to silence tracing for this command. */
  trace?: boolean;
}

/** Options accepted by `ProcessRunner#start()` and `ProcessRunner#run()`. */
export interface StartOptions extends ProcessOptions {
  /** Run asynchronously (default) or synchronously. */
  mode?: 'async' | 'sync';
  stdout?: 'pipe';
  stderr?: 'pipe';
}

/** `start()`/`run()` options that select synchronous execution. */
export interface SyncStartOptions extends StartOptions {
  mode: 'sync';
}

// ---------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------

/**
 * Captured output stream in a result. It is a real `Readable` that replays
 * the captured text, and it also behaves like that text: it converts to a
 * string implicitly and proxies the common read-only string methods.
 */
export interface CapturedReadable extends Readable {
  toString(): string;
  valueOf(): string;
  toJSON(): string;
  [Symbol.toPrimitive](hint: string): string;
  readonly length: number;
  trim(): string;
  trimStart(): string;
  trimEnd(): string;
  slice(start?: number, end?: number): string;
  split(separator: string | RegExp, limit?: number): string[];
  includes(searchString: string, position?: number): boolean;
  startsWith(searchString: string, position?: number): boolean;
  endsWith(searchString: string, endPosition?: number): boolean;
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  match(matcher: string | RegExp): RegExpMatchArray | null;
  matchAll(regexp: RegExp): IterableIterator<RegExpExecArray>;
  replace(searchValue: string | RegExp, replaceValue: string): string;
  replace(
    searchValue: string | RegExp,
    replacer: (substring: string, ...args: any[]) => string
  ): string;
  replaceAll(searchValue: string | RegExp, replaceValue: string): string;
  replaceAll(
    searchValue: string | RegExp,
    replacer: (substring: string, ...args: any[]) => string
  ): string;
  search(matcher: string | RegExp): number;
  substring(start: number, end?: number): string;
  toLowerCase(): string;
  toUpperCase(): string;
  at(index: number): string | undefined;
}

/** Captured stdin in a result: a `Writable` that converts to the input text. */
export interface CapturedWritable extends Writable {
  readonly chunks: Buffer[];
  toString(): string;
  valueOf(): string;
  toJSON(): string;
  [Symbol.toPrimitive](hint: string): string;
}

/** Fields shared by every command result. */
export interface ResultBase {
  /** Exit code of the command. */
  code: number;
  /** Alias of `code`. */
  exitCode: number;
  /** Resolves to the captured stdout text. */
  text(): Promise<string>;
}

/**
 * Result with plain string output, as stored in `ProcessRunner#result`
 * and passed to the `'end'` event.
 */
export interface CommandResult extends ResultBase {
  /** Captured stdout; `undefined` when `capture` is `false`. */
  stdout?: string;
  /** Captured stderr; `undefined` when `capture` is `false`. */
  stderr?: string;
  /** Captured stdin; `undefined` when `capture` is `false`. */
  stdin?: string;
}

/**
 * Result returned by awaiting a command, `sync()`, `sh()`, `exec()` and
 * `run()`. Output is exposed as string-like streams.
 */
export interface StreamResult extends ResultBase {
  /** Captured stdout; `undefined` when `capture` is `false`. */
  stdout: CapturedReadable | undefined;
  /** Captured stderr; `undefined` when `capture` is `false`. */
  stderr: CapturedReadable | undefined;
  /** Captured stdin. */
  stdin: CapturedWritable;
}

/**
 * Error thrown for a non-zero exit code while `errexit` is enabled
 * (`set('e')`), and by pipelines under `pipefail`.
 */
export interface CommandError extends Error {
  code: number;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  result?: CommandResult;
}

// ---------------------------------------------------------------------------
// Streaming and events
// ---------------------------------------------------------------------------

/** Output stream names. */
export type OutputStreamName = 'stdout' | 'stderr';

/** A chunk of command output. */
export interface OutputChunk<T extends OutputStreamName = OutputStreamName> {
  type: T;
  data: Buffer;
}

/** Final item yielded by `stream()` once the command exits. */
export interface ExitChunk {
  type: 'exit';
  code: number;
}

/** Items yielded by `ProcessRunner#stream()` and `for await ... of runner`. */
export type StreamChunk = OutputChunk | ExitChunk;

/** Event name to listener arguments for `ProcessRunner`. */
export interface ProcessRunnerEvents {
  /** A chunk written to stdout. */
  stdout: [chunk: Buffer];
  /** A chunk written to stderr. */
  stderr: [chunk: Buffer];
  /** A chunk written to either output stream. */
  data: [chunk: OutputChunk];
  /** The command finished; emitted before `'exit'`. */
  end: [result: CommandResult];
  /** The exit code; emitted after `'end'`. */
  exit: [code: number];
}

/** Name of a `ProcessRunner` event. */
export type ProcessRunnerEventName = keyof ProcessRunnerEvents;

/** Listener for a `ProcessRunner` event. */
export type ProcessRunnerListener<K extends ProcessRunnerEventName> = (
  ...args: ProcessRunnerEvents[K]
) => void;

/** Typed event emitter base of `ProcessRunner` (not exported at runtime). */
declare class StreamEmitter<
  Events extends { [K in keyof Events]: unknown[] } = ProcessRunnerEvents,
> {
  /** Registered listeners by event name. */
  listeners: Map<keyof Events, Array<(...args: any[]) => void>>;
  on<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void
  ): this;
  once<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void
  ): this;
  off<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void
  ): this;
  emit<K extends keyof Events>(event: K, ...args: Events[K]): this;
}

// ---------------------------------------------------------------------------
// ProcessRunner
// ---------------------------------------------------------------------------

/** Readable end of a child stream (Node.js stream, or web stream under Bun). */
export type ChildReadableStream = Readable | ReadableStream<Uint8Array>;

/** Writable end of a child's stdin (Node.js stream, or Bun `FileSink`). */
export type ChildWritableStream =
  | Writable
  | {
      write(chunk: string | ArrayBufferView | ArrayBuffer): unknown;
      end(): unknown;
    };

/**
 * Stable handle returned by `ProcessRunner#child` while a command starts.
 * Its properties reflect the native child once it has spawned.
 */
export interface PendingChildHandle {
  readonly native: ChildProcess | RuntimeSubprocess | undefined;
  readonly pid: number | undefined;
  readonly stdin: ChildWritableStream | null;
  readonly stdout: ChildReadableStream | null;
  readonly stderr: ChildReadableStream | null;
  readonly killed: boolean;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  /** Kill the command; returns `false` when it has already finished. */
  kill(signal?: KillSignal): boolean;
}

/** Native subprocess created by the Bun runtime. */
export interface RuntimeSubprocess {
  readonly pid: number;
  readonly stdin: ChildWritableStream | null | undefined;
  readonly stdout: ChildReadableStream | null | undefined;
  readonly stderr: ChildReadableStream | null | undefined;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal?: KillSignal | number): void;
}

/** Value of `ProcessRunner#child` while the command is running. */
export type ProcessChild =
  ChildProcess | RuntimeSubprocess | PendingChildHandle;

/** Command specification passed to the `ProcessRunner` constructor. */
export type CommandSpec =
  | { mode: 'shell'; command: string }
  | { mode: 'shell'; file: string; args?: string[] }
  | { mode: 'exec'; file: string; args: string[] }
  | { mode: 'pipeline'; source: ProcessRunner; destination: ProcessRunner };

/** Anything `ProcessRunner#pipe()` accepts as its destination. */
export type PipeDestination =
  ProcessRunner | { spec: CommandSpec; options?: ProcessOptions };

/** Values available as either a ready value or a promise of it. */
export type MaybePromise<T> = T | Promise<T>;

/** Lazily started views of a command's stdio. */
export interface StdioViews<In, Out = In> {
  readonly stdin: In;
  readonly stdout: Out;
  readonly stderr: Out;
}

/**
 * A command. It is lazy until awaited, iterated, started or read from, and
 * it is a thenable that resolves to a {@link StreamResult}.
 */
export declare class ProcessRunner
  extends StreamEmitter<ProcessRunnerEvents>
  implements PromiseLike<StreamResult>, AsyncIterable<StreamChunk>
{
  constructor(spec: CommandSpec, options?: ProcessOptions);

  spec: CommandSpec;
  options: ProcessOptions;
  /** Result once the command has finished, otherwise `null`. */
  result: CommandResult | null;
  started: boolean;
  finished: boolean;
  promise: Promise<StreamResult> | null;
  outChunks: Buffer[] | null;
  errChunks: Buffer[] | null;
  inChunks: Buffer[] | null;

  /** OS process id; `undefined` before spawn and for virtual commands. */
  readonly pid: number | undefined;
  /** Child handle (reading it starts the command); `null` once finished. */
  readonly child: ProcessChild | null;
  readonly stdout: ChildReadableStream | null;
  readonly stderr: ChildReadableStream | null;
  readonly stdin: ChildWritableStream | null;
  /** Child streams; reading one starts the command. */
  readonly streams: StdioViews<
    MaybePromise<ChildWritableStream | null> | null,
    MaybePromise<ChildReadableStream | null> | null
  >;
  /** Captured output as Buffers; reading one starts the command. */
  readonly buffers: StdioViews<MaybePromise<Buffer>>;
  /** Captured output as strings; reading one starts the command. */
  readonly strings: StdioViews<MaybePromise<string>>;

  start(options: SyncStartOptions): StreamResult;
  start(options?: StartOptions): Promise<StreamResult>;
  run(options: SyncStartOptions): StreamResult;
  run(options?: StartOptions): Promise<StreamResult>;
  /** Run synchronously and return the result. */
  sync(): StreamResult;
  /** Run asynchronously and resolve to the result. */
  async(): Promise<StreamResult>;

  then<TResult1 = StreamResult, TResult2 = never>(
    onfulfilled?:
      ((value: StreamResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<StreamResult | TResult>;
  finally(onfinally?: (() => void) | null): Promise<StreamResult>;

  /** Stop mirroring output to the parent's stdout/stderr. */
  quiet(): this;
  /** Pipe this command's stdout into `destination`; returns a new runner. */
  pipe(destination: PipeDestination): ProcessRunner;
  /** Iterate output chunks, ending with an `exit` chunk. */
  stream(): AsyncGenerator<StreamChunk, void, unknown>;
  [Symbol.asyncIterator](): AsyncGenerator<StreamChunk, void, unknown>;
  /** Kill the command (defaults to the `killSignal` option). */
  kill(signal?: KillSignal): void;
  /** Complete the command with `result`; used internally. */
  finish(result: CommandResult): CommandResult;
}

// ---------------------------------------------------------------------------
// Tagged templates and entry points
// ---------------------------------------------------------------------------

/** Interpolated value that is spliced into the command without quoting. */
export interface RawValue {
  raw: string;
}

/** Interpolated value that is double-quoted, keeping apostrophes intact. */
export interface LiteralValue {
  literal: string;
}

/**
 * Value accepted inside a command template. Arrays are expanded into
 * separately quoted arguments; everything else is converted to a string.
 */
export type TemplateValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | RawValue
  | LiteralValue
  | { toString(): string }
  | readonly TemplateValue[];

/** Tagged template that builds a {@link ProcessRunner}. */
export interface CommandTag {
  (strings: TemplateStringsArray, ...values: TemplateValue[]): ProcessRunner;
}

/** `cross-spawn`, re-exported as `spawn` and `$.spawn`. */
export interface CrossSpawn {
  (
    command: string,
    args?: readonly string[],
    options?: SpawnOptions
  ): ChildProcess;
  (command: string, options?: SpawnOptions): ChildProcess;
  spawn: CrossSpawn;
  sync(
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions
  ): SpawnSyncReturns<string | Buffer>;
  sync(
    command: string,
    options?: SpawnSyncOptions
  ): SpawnSyncReturns<string | Buffer>;
}

/** The `$` export: a tagged template, or `$(options)` returning one. */
export interface Dollar extends CommandTag {
  (options: ProcessOptions): CommandTag;
  spawn: CrossSpawn;
  /** zx compatibility mode: the `$` of `command-stream/zx`. */
  readonly zx: typeof import('./zx-api.cjs').$;
}

export declare const $: Dollar;

/** Run a shell command string. */
export declare function sh(
  command: string,
  options?: ProcessOptions
): Promise<StreamResult>;

/** Run `file` with `args` directly, without a shell. */
export declare function exec(
  file: string,
  args?: string[],
  options?: ProcessOptions
): Promise<StreamResult>;

/**
 * Run a shell command string, or an argv array without a shell, with
 * `mirror: false` and `capture: true`.
 */
export declare function run(
  command: string | readonly string[],
  options?: ProcessOptions
): Promise<StreamResult>;

/** Create a tagged template with default options. */
export declare function create(defaultOptions?: ProcessOptions): CommandTag;

export declare const spawn: CrossSpawn;

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

/** Quote context of an interpolation site. */
export type QuoteContext = 'unquoted' | 'single' | 'double';

export declare function quote(value: unknown): string;
export declare function quoteForContext(
  value: unknown,
  context?: QuoteContext
): string;
export declare function quoteLiteral(value: unknown): string;
export declare function raw(value: unknown): RawValue;
export declare function literal(value: unknown): LiteralValue;
export declare function isQuoteContextEnabled(): boolean;
/** `true`/`false` force the setting; `null` follows the environment again. */
export declare function setQuoteContextEnabled(
  enabled: boolean | null
): boolean;
export declare function isPreQuotedPassthroughEnabled(): boolean;
/** `true`/`false` force the setting; `null` follows the environment again. */
export declare function setPreQuotedPassthroughEnabled(
  enabled: boolean | null
): boolean;

// ---------------------------------------------------------------------------
// Shell settings
// ---------------------------------------------------------------------------

/** Global shell settings, mirroring `set -e/-v/-x/-u/-o pipefail`. */
export interface ShellSettings {
  errexit: boolean;
  verbose: boolean;
  xtrace: boolean;
  pipefail: boolean;
  nounset: boolean;
  noglob?: boolean;
  allexport?: boolean;
}

/** Option names accepted by `set()` and `unset()`. */
export type ShellOption =
  | 'e'
  | 'errexit'
  | 'v'
  | 'verbose'
  | 'x'
  | 'xtrace'
  | 'u'
  | 'nounset'
  | 'o pipefail'
  | 'pipefail';

export declare function set(option: ShellOption): ShellSettings;
export declare function unset(option: ShellOption): ShellSettings;

/** Convenience wrappers around `set()`/`unset()` and quoting settings. */
export interface Shell {
  set(option: ShellOption): ShellSettings;
  unset(option: ShellOption): ShellSettings;
  /** Snapshot of the current settings. */
  settings(): ShellSettings;
  errexit(enable?: boolean): ShellSettings;
  verbose(enable?: boolean): ShellSettings;
  xtrace(enable?: boolean): ShellSettings;
  pipefail(enable?: boolean): ShellSettings;
  nounset(enable?: boolean): ShellSettings;
  quoteContext(enable?: boolean | null): boolean;
  preQuotedPassthrough(enable?: boolean | null): boolean;
}

export declare const shell: Shell;

/** Reset shell settings, ANSI config, cwd and runner bookkeeping. */
export declare function resetGlobalState(): void;
/** Kill all active commands and remove signal handlers. */
export declare function forceCleanupAll(): void;

// ---------------------------------------------------------------------------
// Virtual commands
// ---------------------------------------------------------------------------

/** Context passed to a virtual command handler. */
export interface VirtualCommandContext extends Partial<
  Omit<ProcessOptions, 'stdin'>
> {
  /** Arguments after the command name, with quotes removed. */
  args: string[];
  /** Input text (piped output, or the `stdin` option's data). */
  stdin: string;
  /** Aborted when the command is killed (absent inside pipelines). */
  abortSignal?: AbortSignal;
  /** Returns `true` once the command is killed (absent inside pipelines). */
  isCancelled?: () => boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Options of the running command. */
  options?: ProcessOptions;
}

/** Result of a function-style virtual command. Missing fields default to `0`/`''`. */
export interface VirtualCommandResult {
  code?: number;
  stdout?: string;
  stderr?: string;
  [key: string]: unknown;
}

/** Virtual command returning a result (optionally asynchronously). */
export type VirtualCommandFunction = (
  context: VirtualCommandContext
) => VirtualCommandResult | Promise<VirtualCommandResult>;

/** Chunk yielded by a streaming virtual command. */
export type VirtualCommandChunk = string | Buffer | Uint8Array;

/**
 * Streaming virtual command. Must be declared with `async function*`:
 * yielded chunks are written to stdout and the exit code is `0`.
 */
export type VirtualCommandGenerator = (
  context: VirtualCommandContext
) => AsyncGenerator<VirtualCommandChunk, unknown, unknown>;

/** Handler accepted by `register()`. */
export type VirtualCommandHandler =
  VirtualCommandFunction | VirtualCommandGenerator;

/** Register (or replace) a virtual command; returns the command registry. */
export declare function register(
  name: string,
  handler: VirtualCommandHandler
): Map<string, VirtualCommandHandler>;
/** Remove a virtual command; returns whether it existed. */
export declare function unregister(name: string): boolean;
/** Names of all registered virtual commands. */
export declare function listCommands(): string[];
export declare function enableVirtualCommands(): true;
export declare function disableVirtualCommands(): false;

// ---------------------------------------------------------------------------
// ANSI handling
// ---------------------------------------------------------------------------

/** Global ANSI handling configuration. */
export interface AnsiConfig {
  preserveAnsi: boolean;
  preserveControlChars: boolean;
}

export interface AnsiUtilities {
  stripAnsi(text: string): string;
  stripControlChars(text: string): string;
  stripAll(text: string): string;
  cleanForProcessing(data: Buffer): Buffer;
  cleanForProcessing(data: string): string;
}

export declare const AnsiUtils: AnsiUtilities;
export declare function configureAnsi(
  options?: Partial<AnsiConfig>
): AnsiConfig;
export declare function getAnsiConfig(): AnsiConfig;
export declare function processOutput(
  data: Buffer,
  options?: Partial<AnsiConfig>
): Buffer;
export declare function processOutput(
  data: string,
  options?: Partial<AnsiConfig>
): string;

// ---------------------------------------------------------------------------
// Terminal capture
// ---------------------------------------------------------------------------

/** Named keys accepted by `TerminalInteraction.key`. */
export type TerminalKeyName =
  | 'BACKSPACE'
  | 'CTRL_C'
  | 'CTRL_D'
  | 'DOWN'
  | 'ENTER'
  | 'ESCAPE'
  | 'LEFT'
  | 'RIGHT'
  | 'TAB'
  | 'UP';

/** Terminal dimensions in cells. */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * One scripted step: an action (`text`, `key` or `resize`), optionally
 * preceded by a wait (`after` pattern or `idleMilliseconds`).
 */
export interface TerminalInteraction {
  text?: unknown;
  /** A {@link TerminalKeyName}, or a raw escape sequence. */
  key?: TerminalKeyName | (string & {});
  resize?: TerminalSize;
  after?: string | RegExp;
  idleMilliseconds?: number;
  timeoutMilliseconds?: number;
}

/** Rendering options for the SVG/GIF artifacts. */
export interface TerminalArtifactOptions {
  background?: string;
  foreground?: string;
  cellWidth?: number;
  cellHeight?: number;
  fontSize?: number;
  padding?: number;
  borderRadius?: number;
  idleTimeLimit?: number;
}

/** Diagnostic event passed to `onTrace`. */
export interface TerminalTraceEvent {
  time: number;
  type: string;
  [key: string]: unknown;
}

/** Options for `captureTerminal()` and `openTerminal()`. */
export interface TerminalOptions {
  file: string;
  args?: unknown[];
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Default: `80`. */
  cols?: number;
  /** Derived from `cols` and `aspectRatio` when omitted. */
  rows?: number;
  /** Default: `4 / 3`. */
  aspectRatio?: number;
  /** Default: `35`. */
  settleMilliseconds?: number;
  interactions?: TerminalInteraction[];
  stopMarker?: string | RegExp;
  /** Default: `250`. */
  stopMarkerGraceMilliseconds?: number;
  /** `captureTerminal()` default: `30000`. */
  timeoutMilliseconds?: number;
  artifactDirectory?: string;
  artifactOptions?: TerminalArtifactOptions;
  onTrace?: (event: TerminalTraceEvent) => void;
  label?: string;
}

/** One rendered cell of a terminal frame. */
export interface TerminalCell {
  chars: string;
  width: number;
  fg?: string | null;
  bg?: string | null;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  reverse?: boolean;
  strikethrough?: boolean;
  invisible?: boolean;
}

/** A settled terminal screen state. */
export interface TerminalFrame {
  time: number;
  cols: number;
  rows: number;
  cursor: { x: number; y: number };
  alternate: boolean;
  lines: string[];
  screen: string[];
  cells: TerminalCell[][];
}

/** Asciicast v2 recording held in memory. */
export interface TerminalAsciicast {
  header: {
    version: 2;
    width: number;
    height: number;
    timestamp: number;
    env: { SHELL?: string; TERM?: string };
  };
  events: Array<{ time: number; code: 'i' | 'o' | 'r'; data: string }>;
}

/** How a terminal command exited. */
export interface TerminalExitStatus {
  exitCode: number;
  signal: number | string | undefined;
}

/** Result of a terminal capture. */
export interface TerminalCaptureResult extends TerminalExitStatus {
  /** Raw output bytes as text. */
  output: string;
  /** Scrollback-style transcript of the frames. */
  transcript: string;
  frames: TerminalFrame[];
  interactionCount: number;
  asciicast: TerminalAsciicast;
}

/** Error thrown when a terminal capture times out. */
export interface TerminalCaptureError extends Error {
  capture?: TerminalCaptureResult;
}

/** Options for `TerminalSession#waitFor()`. */
export interface TerminalWaitOptions {
  idleMilliseconds?: number;
  timeoutMilliseconds?: number;
}

/** Options for `TerminalSession#close()` and `dispose()`. */
export interface TerminalCloseOptions {
  signal?: KillSignal;
  timeoutMilliseconds?: number;
}

/** Disposable subscription returned by `TerminalProcess` listeners. */
export interface TerminalDisposable {
  dispose(): void;
}

/** Pseudoterminal process proxy exposed as `TerminalSession#process`. */
export interface TerminalProcess {
  onData(listener: (data: string) => void): TerminalDisposable;
  onExit(
    listener: (event: {
      exitCode: number;
      signal?: number | string;
      error?: Error;
    }) => void
  ): TerminalDisposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

/** A live pseudoterminal session returned by `openTerminal()`. */
export interface TerminalSession {
  readonly output: string;
  readonly transcript: string;
  readonly frames: TerminalFrame[];
  readonly asciicast: TerminalAsciicast;
  readonly exitStatus: TerminalExitStatus | undefined;
  readonly running: boolean;
  /** The pseudoterminal process. */
  readonly process: TerminalProcess;
  /** The headless xterm.js terminal. */
  readonly terminal: unknown;
  readonly exited: Promise<TerminalExitStatus>;
  /** Wait for `pattern` (or for output to go idle) and return the transcript. */
  waitFor(
    pattern?: string | RegExp,
    options?: TerminalWaitOptions
  ): Promise<string>;
  /** Apply interactions and return the transcript. */
  send(input: TerminalInteraction | TerminalInteraction[]): Promise<string>;
  /** Wait for the command to exit and return the capture. */
  finished(): Promise<TerminalCaptureResult>;
  /** Stop the command and return the capture. */
  close(options?: TerminalCloseOptions): Promise<TerminalCaptureResult>;
  /** Like `close()`, but never rejects. */
  dispose(
    options?: TerminalCloseOptions
  ): Promise<TerminalCaptureResult | undefined>;
}

/** Asciicast recording parsed from a `.cast` file. */
export interface ParsedAsciicast {
  header: TerminalAsciicast['header'] & Record<string, unknown>;
  events: Array<{
    time: number;
    type: 'input' | 'output' | 'resize' | (string & {});
    data: string;
  }>;
}

/** Run a command in a pseudoterminal until it exits. */
export declare function captureTerminal(
  options: TerminalOptions
): Promise<TerminalCaptureResult>;
/** Open a pseudoterminal session that stays alive until closed. */
export declare function openTerminal(
  options: TerminalOptions
): Promise<TerminalSession>;
/** Read an asciicast v2 file. */
export declare function readAsciicast(path: string): Promise<ParsedAsciicast>;
/** Join frames into a scrollback-style transcript. */
export declare function unrollTerminalFrames(
  frames: ReadonlyArray<Pick<TerminalFrame, 'lines'>>
): string;

export type { StreamEmitter };
