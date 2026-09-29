/**
 * TypeScript declarations for the zx-compatible API (`command-stream/zx`).
 *
 * Both zx entry points re-export these: `zx.d.ts` for `import` and
 * `zx.d.cts` for `require`, and `zx-core.d.ts` / `zx-core.d.cts` re-export
 * the subset that `src/zx/core.mjs` provides. Like `api.d.cts`, this is a
 * CommonJS declaration file so both module formats can load it on every
 * TypeScript version.
 *
 * The shapes follow zx 8's public typings (`zx/build/*.d.ts`), restricted to
 * what `src/zx/index.mjs` actually exports. The bundled helper libraries
 * (`fs`, `glob`, `YAML`, `MAML`, `minimist`, `dotenv`, `chalk`, `which`, `ps`)
 * are dependency-free re-implementations in `src/zx/vendor/`, so their types
 * are declared here instead of being borrowed from `fs-extra`, `globby`,
 * `yaml`, ... Type-level behaviour is exercised by `tests/types/zx*.ts`, which
 * `npm run check:types` compiles in strict mode.
 */

/// <reference types="node" />

import type {
  ChildProcess,
  IOType,
  StdioOptions,
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from 'node:child_process';
import type { Dirent, Mode, PathLike, Stats } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import { inspect } from 'node:util';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * A duration: milliseconds as a number or numeric string, or a string with an
 * `ms`, `s` or `m` suffix (`'100ms'`, `'5s'`, `'1m'`).
 */
export type Duration =
  number | `${number}` | `${number}m` | `${number}s` | `${number}ms`;

/** First argument accepted by `fetch()`. */
export type RequestInfo = Parameters<typeof globalThis.fetch>[0];

/** Second argument accepted by `fetch()`. */
export type RequestInit = NonNullable<Parameters<typeof globalThis.fetch>[1]>;

/** Output chunks captured from a command, per stream. */
export interface SpawnStore {
  stdout: Array<string | Buffer>;
  stderr: Array<string | Buffer>;
  stdall: Array<string | Buffer>;
}

/** Quote a value interpolated into a `$` template (bash or PowerShell). */
export declare function quote(arg: string): string;
export declare function quotePowerShell(arg: string): string;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** An entry passed to `$.log` (only `verbose` entries are printed). */
export type LogEntry = { verbose?: boolean } & (
  | { kind: 'cmd'; cmd: string; cwd: string; id: string }
  | { kind: 'stdout'; data: Buffer; id: string }
  | { kind: 'stderr'; data: Buffer; id: string }
  | {
      kind: 'end';
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      duration: number;
      error: null | Error;
      id: string;
    }
  | { kind: 'cd'; dir: string }
  | { kind: 'fetch'; url: RequestInfo; init?: RequestInit }
  | {
      kind: 'retry';
      attempt: number;
      total: number;
      delay: number;
      exception: unknown;
      error?: string;
    }
  | { kind: 'custom'; data: any }
  | { kind: 'kill'; pid: number | `${number}`; signal: NodeJS.Signals | null }
);

/** Per-kind renderers that `log` consults before its built-in ones. */
export type LogFormatters = {
  [K in LogEntry['kind']]: (
    entry: Extract<LogEntry, { kind: K }>
  ) => string | Buffer;
};

export interface Log {
  (entry: LogEntry): void;
  formatters?: Partial<LogFormatters>;
  /** Stream written to; `process.stderr` when unset. */
  output?: NodeJS.WriteStream;
}

export declare const log: Log;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export declare class Fail extends Error {
  static DOCS_URL: string;
  static EXIT_CODES: Record<number, string>;
  static ERRNO_CODES: Record<number, string>;
  static formatExitMessage(
    code: number | null,
    signal: NodeJS.Signals | null,
    stderr: string,
    from: string,
    details?: string
  ): string;
  static formatErrorMessage(err: NodeJS.ErrnoException, from: string): string;
  static formatErrorDetails(lines?: string[], lim?: number): string;
  static getExitCodeInfo(exitCode: number | null): string | undefined;
  static getCallerLocationFromString(stackString?: string): string;
  static getCallerLocation(err?: Error): string;
  static getErrnoMessage(errno?: number): string;
}

// ---------------------------------------------------------------------------
// Options and `$`
// ---------------------------------------------------------------------------

/** Options of `$`: read and written as `$.verbose`, or passed as `$({...})`. */
export interface Options {
  cwd?: string;
  ac?: AbortController;
  signal?: AbortSignal;
  input?: string | Buffer | Readable | ProcessOutput | ProcessPromise;
  timeout?: Duration;
  timeoutSignal?: NodeJS.Signals;
  stdio: StdioOptions;
  verbose: boolean;
  sync: boolean;
  env: NodeJS.ProcessEnv;
  /** Shell binary, or `true` for the platform default. */
  shell: string | true;
  nothrow: boolean;
  prefix?: string;
  postfix?: string;
  quote?: typeof quote;
  quiet: boolean;
  detached: boolean;
  /** Prepend `node_modules/.bin` of the cwd (or of the given dirs) to PATH. */
  preferLocal: boolean | string | string[];
  spawn: typeof nodeSpawn;
  spawnSync: typeof nodeSpawnSync;
  store?: SpawnStore;
  log: Log;
  kill: typeof kill;
  killSignal?: NodeJS.Signals;
  /** Create the process without starting it; see `ProcessPromise.run()`. */
  halt?: boolean;
  delimiter?: string | RegExp;
}

/**
 * The `$` tagged template. With `S = true` (from `$.sync` or
 * `$({ sync: true })`) commands run synchronously and return a
 * `ProcessOutput`.
 */
export interface Shell<
  S = false,
  R = S extends true ? ProcessOutput : ProcessPromise,
> {
  (pieces: TemplateStringsArray, ...args: any[]): R;
  <
    O extends Partial<Options> = Partial<Options>,
    R = O extends { sync: true } ? Shell<true> : Shell,
  >(
    opts: O
  ): R;
  /** Synchronous flavour of `$`. */
  sync: {
    (pieces: TemplateStringsArray, ...args: any[]): ProcessOutput;
    (opts: Partial<Omit<Options, 'sync'>>): Shell<true>;
  };
}

/**
 * `$` doubles as the options store of the current `within()` scope. Reading
 * `$.sync` returns the synchronous flavour rather than the `sync` option.
 */
export type $ = Shell & Omit<Options, 'sync'>;
export declare const $: $;

/** The global options that `within()` scopes copy. */
export declare const defaults: Options;

/** Apply `ZX_*` environment variables (camel-cased) onto `defs`. */
export declare function resolveDefaults<T extends object = Options>(
  defs?: T,
  prefix?: string,
  env?: NodeJS.ProcessEnv,
  allowed?: Set<string>
): T;

/** Run `callback` with a private copy of the `$` options. */
export declare function within<R>(callback: () => R): R;

/** Change the working directory of `$` (and of the process). */
export declare function cd(dir: string | ProcessOutput): void;

/** Kill a process and all of its descendants. */
export declare function kill(
  pid: number | `${number}`,
  signal?: NodeJS.Signals
): Promise<void>;

/** Keep `process.cwd()` in sync with `$.cwd` (on by default when `flag`). */
export declare function syncProcessCwd(flag?: boolean): void;

/** Switch `$` to bash (the default). */
export declare const useBash: () => void;
/** Switch `$` to PowerShell Core (`pwsh`). */
export declare const usePwsh: () => void;
/** Switch `$` to Windows PowerShell (`powershell.exe`). */
export declare const usePowerShell: () => void;

// ---------------------------------------------------------------------------
// ProcessPromise
// ---------------------------------------------------------------------------

export type ProcessStage =
  'initial' | 'halted' | 'running' | 'fulfilled' | 'rejected';

/** A writable pipe destination that is also awaitable. */
export type PromisifiedStream<D extends Writable = Writable> = D &
  PromiseLike<ProcessOutput & D> & {
    run(): void;
  };

/** Accepted by `ProcessPromise.unpipe()`. */
export type PipeAcceptor = Writable | ProcessPromise;

/**
 * `p.pipe` (and `p.pipe.stdout`, `p.pipe.stderr`, `p.pipe.stdall`): pipe into
 * a command (template literal), a file path, a writable stream or another
 * `ProcessPromise`.
 */
export interface PipeMethod {
  (dest: TemplateStringsArray, ...args: any[]): ProcessPromise;
  (file: string): PromisifiedStream;
  <D extends Writable>(dest: D): PromisifiedStream<D>;
  <D extends ProcessPromise>(dest: D): D;
}

export declare class ProcessPromise extends Promise<ProcessOutput> {
  private _stage;
  private _id;
  private _snapshot;
  private _timeoutId;
  private _piped;
  private _stdin;
  private _zurk;
  private _output;
  private _resolve;
  private _reject;
  /** Use `$` instead: instances created directly are disarmed. */
  constructor(
    executor: (
      resolve: (out: ProcessOutput) => void,
      reject: (error: ProcessOutput | Error) => void
    ) => void
  );
  private build;
  private execOptions;
  private resolveCmd;
  private lifecycleHandlers;
  private onEnd;
  private break;
  private finalize;
  /** Start a halted process. */
  run(): this;
  abort(reason?: string): void;
  kill(signal?: NodeJS.Signals | null): Promise<void>;
  stdio(stdin: IOType | StdioOptions, stdout?: IOType, stderr?: IOType): this;
  nothrow(v?: boolean): this;
  quiet(v?: boolean): this;
  verbose(v?: boolean): this;
  timeout(d?: Duration, signal?: NodeJS.Signals): this;
  /** @deprecated Use $({halt: true})`cmd` instead. */
  halt(): this;
  get id(): string;
  get pid(): number | undefined;
  get cwd(): string;
  get cmd(): string;
  get fullCmd(): string;
  get child(): ChildProcess | undefined;
  /** Undefined until the child process has been spawned. */
  get stdin(): Writable;
  get stdout(): Readable;
  get stderr(): Readable;
  get exitCode(): Promise<number | null>;
  get signal(): AbortSignal;
  get ac(): AbortController;
  get output(): ProcessOutput | null;
  get stage(): ProcessStage;
  get sync(): boolean;
  get [Symbol.toStringTag](): string;
  [Symbol.toPrimitive](): string;
  json<T = any>(): Promise<T>;
  text(encoding?: BufferEncoding): Promise<string>;
  lines(delimiter?: string | RegExp): Promise<string[]>;
  buffer(): Promise<Buffer>;
  blob(type?: string): Promise<Blob>;
  isQuiet(): boolean;
  isVerbose(): boolean;
  isNothrow(): boolean;
  isHalted(): boolean;
  isSettled(): boolean;
  isRunning(): boolean;
  get pipe(): PipeMethod & { [K in keyof SpawnStore]: PipeMethod };
  unpipe(to?: PipeAcceptor): this;
  private _pipe;
  private feedPipe;
  private fillPipe;
  private endPipe;
  private fillSettled;
  then<R = ProcessOutput, E = ProcessOutput>(
    onfulfilled?:
      ((value: ProcessOutput) => PromiseLike<R> | R) | undefined | null,
    onrejected?:
      ((reason: ProcessOutput) => PromiseLike<E> | E) | undefined | null
  ): Promise<R | E>;
  catch<T = ProcessOutput>(
    onrejected?:
      ((reason: ProcessOutput) => PromiseLike<T> | T) | undefined | null
  ): Promise<ProcessOutput | T>;
  /** Iterate over stdout line by line. */
  [Symbol.asyncIterator](): AsyncIterator<string>;
  private writable;
  private emit;
  private on;
  private once;
  private write;
  private end;
  private removeListener;
  private static bus;
  private static promisifyStream;
  private static disarm;
}

// ---------------------------------------------------------------------------
// ProcessOutput
// ---------------------------------------------------------------------------

/** Constructor data of a `ProcessOutput`. */
export interface ProcessDto {
  code: number | null;
  signal: NodeJS.Signals | null;
  duration: number;
  error: any;
  from: string;
  store: SpawnStore;
  delimiter?: string | RegExp;
}

export declare class ProcessOutput extends Error {
  private readonly _dto;
  cause: Error | null;
  message: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdall: string;
  constructor(dto: ProcessDto);
  constructor(
    code?: number | null,
    signal?: NodeJS.Signals | null,
    stdout?: string,
    stderr?: string,
    stdall?: string,
    message?: string,
    duration?: number
  );
  get exitCode(): number | null;
  get signal(): NodeJS.Signals | null;
  get duration(): number;
  get [Symbol.toStringTag](): string;
  get ok(): boolean;
  json<T = any>(): T;
  buffer(): Buffer;
  blob(type?: string): Blob;
  text(encoding?: BufferEncoding): string;
  lines(delimiter?: string | RegExp): string[];
  toString(): string;
  valueOf(): string;
  [Symbol.toPrimitive](): string;
  [Symbol.iterator](delimiter?: string | RegExp): Iterator<string>;
  [inspect.custom](): string;
  static getExitMessage: typeof Fail.formatExitMessage;
  static getErrorMessage: typeof Fail.formatErrorMessage;
  static getErrorDetails: typeof Fail.formatErrorDetails;
  static getExitCodeInfo: typeof Fail.getExitCodeInfo;
  /** Build the error message of `output` (not part of zx's typings). */
  static describe(
    output: ProcessOutput,
    dto: ProcessDto,
    message: string
  ): string;
  static fromError(error: Error): ProcessOutput;
}

// ---------------------------------------------------------------------------
// Override bus
// ---------------------------------------------------------------------------

/**
 * Registry behind the bundled helpers (`chalk`, `which`, `ps`, `fs`, `glob`,
 * `YAML`, `MAML`, `minimist`, `dotenv`). `command-stream/zx` locks it on load,
 * so `wrap()` then throws; `override()` still swaps an implementation.
 */
export declare const bus: {
  override(name: string, api: any): Map<string, any>;
  wrap<T extends object>(name: string, api: T): T;
  lock(): void;
};

// ---------------------------------------------------------------------------
// Node.js re-exports
// ---------------------------------------------------------------------------

export declare const path: typeof import('node:path');
export declare const os: typeof import('node:os');

// ---------------------------------------------------------------------------
// chalk
// ---------------------------------------------------------------------------

type ChalkBaseColor =
  'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white';

export type ChalkModifierName =
  | 'reset'
  | 'bold'
  | 'dim'
  | 'italic'
  | 'underline'
  | 'overline'
  | 'inverse'
  | 'hidden'
  | 'strikethrough'
  | 'visible';

export type ChalkForegroundColorName =
  ChalkBaseColor | `${ChalkBaseColor}Bright` | 'gray' | 'grey';

export type ChalkBackgroundColorName =
  | `bg${Capitalize<ChalkBaseColor>}`
  | `bg${Capitalize<ChalkBaseColor>}Bright`
  | 'bgGray'
  | 'bgGrey';

export type ChalkStyleName =
  ChalkModifierName | ChalkForegroundColorName | ChalkBackgroundColorName;

/** Color support level: 0 none, 1 basic, 2 ansi256, 3 truecolor. */
export type ChalkColorLevel = 0 | 1 | 2 | 3;

export interface ChalkCall {
  (...text: unknown[]): string;
  level: ChalkColorLevel;
  rgb(red: number, green: number, blue: number): ChalkInstance;
  hex(color: string): ChalkInstance;
  ansi256(index: number): ChalkInstance;
  bgRgb(red: number, green: number, blue: number): ChalkInstance;
  bgHex(color: string): ChalkInstance;
  bgAnsi256(index: number): ChalkInstance;
}

/** A chainable chalk 5 style builder: `chalk.bold.red('text')`. */
export type ChalkInstance = ChalkCall & {
  readonly [K in ChalkStyleName]: ChalkInstance;
};

export declare const chalk: ChalkInstance;

// ---------------------------------------------------------------------------
// which
// ---------------------------------------------------------------------------

export interface WhichOptions {
  /** Return every match instead of the first one. */
  all?: boolean;
  /** Search this instead of the PATH environment variable. */
  path?: string;
  /** Use this instead of the PATHEXT environment variable. */
  pathExt?: string;
  /** Use this instead of the platform path delimiter. */
  delimiter?: string;
  /** Return `null` instead of throwing when nothing is found. */
  nothrow?: boolean;
}

type WhichResult<O extends WhichOptions> =
  | (O extends { all: true } ? string[] : string)
  | (O extends { nothrow: true } ? null : never);

export interface Which {
  <O extends WhichOptions = {}>(
    cmd: string,
    options?: O
  ): Promise<WhichResult<O>>;
  sync<O extends WhichOptions = {}>(cmd: string, options?: O): WhichResult<O>;
  which: Which;
}

export declare const which: Which;

// ---------------------------------------------------------------------------
// ps
// ---------------------------------------------------------------------------

export interface PsLookupEntry {
  pid: string;
  ppid?: string;
  command: string;
  arguments: string[];
}

export interface PsLookupQuery {
  pid?: number | string | Array<number | string>;
  ppid?: number | string;
  command?: string;
  arguments?: string;
  psargs?: string | string[];
}

export interface PsTreeOptions {
  pid: number | string;
  recursive?: boolean;
}

export interface PsKillOptions {
  signal?: string | number | NodeJS.Signals;
  /** Seconds to wait for the process to exit. */
  timeout?: number;
}

export type PsLookupCallback = (
  err: any,
  processList?: PsLookupEntry[]
) => void;

export type PsCallback = (err?: any, data?: any) => void;

export interface Ps {
  lookup: {
    (query?: PsLookupQuery, cb?: PsLookupCallback): Promise<PsLookupEntry[]>;
    (cb: PsLookupCallback): Promise<PsLookupEntry[]>;
    sync(query?: PsLookupQuery): PsLookupEntry[];
  };
  lookupSync(query?: PsLookupQuery): PsLookupEntry[];
  tree: {
    (
      opts: number | string | PsTreeOptions,
      cb?: PsLookupCallback
    ): Promise<PsLookupEntry[]>;
    sync(opts: number | string | PsTreeOptions): PsLookupEntry[];
  };
  treeSync(opts: number | string | PsTreeOptions): PsLookupEntry[];
  /** Resolves with the pid once the process has exited. */
  kill(
    pid: number | string,
    opts?: PsCallback | PsKillOptions | PsKillOptions['signal'],
    cb?: PsCallback
  ): Promise<string>;
}

export declare const ps: Ps;

// ---------------------------------------------------------------------------
// fs (fs-extra 11 compatible)
// ---------------------------------------------------------------------------

type NodeFs = typeof import('node:fs');
type NodeFsPromises = typeof import('node:fs/promises');

/** node:fs functions that return a promise when called without a callback. */
type UniversalFsName =
  | 'access'
  | 'appendFile'
  | 'chmod'
  | 'chown'
  | 'close'
  | 'copyFile'
  | 'cp'
  | 'fchmod'
  | 'fchown'
  | 'fdatasync'
  | 'fstat'
  | 'fsync'
  | 'ftruncate'
  | 'futimes'
  | 'lchmod'
  | 'lchown'
  | 'lutimes'
  | 'link'
  | 'lstat'
  | 'mkdir'
  | 'mkdtemp'
  | 'open'
  | 'opendir'
  | 'read'
  | 'readFile'
  | 'readdir'
  | 'readlink'
  | 'readv'
  | 'realpath'
  | 'rename'
  | 'rm'
  | 'rmdir'
  | 'stat'
  | 'statfs'
  | 'symlink'
  | 'truncate'
  | 'unlink'
  | 'utimes'
  | 'write'
  | 'writeFile'
  | 'writev';

/**
 * The promise form of a universalified function: node's `util.promisify`
 * shape (so `open` resolves to a file descriptor and `read` to
 * `{ bytesRead, buffer }`), else the `fs/promises` function.
 */
type FsPromiseForm<K extends keyof NodeFs> = NodeFs[K] extends {
  __promisify__: infer P;
}
  ? P
  : K extends keyof NodeFsPromises
    ? NodeFsPromises[K]
    : unknown;

type UniversalFs = {
  [K in UniversalFsName]: FsPromiseForm<K> & NodeFs[K];
};

export type CopyFilter = (
  src: string,
  dest: string
) => boolean | Promise<boolean>;
export type CopyFilterSync = (src: string, dest: string) => boolean;

export interface CopyOptions {
  dereference?: boolean;
  overwrite?: boolean;
  /** Alias of `overwrite`. */
  clobber?: boolean;
  preserveTimestamps?: boolean;
  errorOnExist?: boolean;
  filter?: CopyFilter;
}

export interface CopyOptionsSync extends Omit<CopyOptions, 'filter'> {
  filter?: CopyFilterSync;
}

export interface MoveOptions {
  overwrite?: boolean;
  /** Alias of `overwrite`. */
  clobber?: boolean;
}

export interface EnsureDirOptions {
  mode?: number;
}

export interface JsonReadOptions {
  encoding?: BufferEncoding | null;
  flag?: string;
  /** Resolve with `null` instead of rejecting on invalid JSON. */
  throws?: boolean;
  reviver?: (key: string, value: any) => any;
}

export interface JsonWriteOptions {
  encoding?: BufferEncoding | null;
  mode?: Mode;
  flag?: string;
  spaces?: number | string;
  EOL?: string;
  finalEOL?: boolean;
  replacer?: ((key: string, value: any) => any) | Array<string | number> | null;
}

export type SymlinkType = 'dir' | 'file' | 'junction';

export type WriteFileData = string | NodeJS.ArrayBufferView;

/** The helpers fs-extra adds on top of node:fs, each with a `*Sync` twin. */
export interface FsExtra {
  copy(
    src: string,
    dest: string,
    options?: CopyOptions | CopyFilter
  ): Promise<void>;
  copySync(
    src: string,
    dest: string,
    options?: CopyOptionsSync | CopyFilterSync
  ): void;
  move(src: string, dest: string, options?: MoveOptions): Promise<void>;
  moveSync(src: string, dest: string, options?: MoveOptions): void;
  remove(path: string): Promise<void>;
  removeSync(path: string): void;
  emptyDir(dir: string): Promise<void>;
  emptyDirSync(dir: string): void;
  emptydir(dir: string): Promise<void>;
  emptydirSync(dir: string): void;
  ensureDir(dir: string, options?: EnsureDirOptions | number): Promise<void>;
  ensureDirSync(dir: string, options?: EnsureDirOptions | number): void;
  mkdirs(dir: string, options?: EnsureDirOptions | number): Promise<void>;
  mkdirsSync(dir: string, options?: EnsureDirOptions | number): void;
  mkdirp(dir: string, options?: EnsureDirOptions | number): Promise<void>;
  mkdirpSync(dir: string, options?: EnsureDirOptions | number): void;
  ensureFile(file: string): Promise<void>;
  ensureFileSync(file: string): void;
  createFile(file: string): Promise<void>;
  createFileSync(file: string): void;
  ensureLink(src: string, dest: string): Promise<void>;
  ensureLinkSync(src: string, dest: string): void;
  createLink(src: string, dest: string): Promise<void>;
  createLinkSync(src: string, dest: string): void;
  ensureSymlink(src: string, dest: string, type?: SymlinkType): Promise<void>;
  ensureSymlinkSync(src: string, dest: string, type?: SymlinkType): void;
  createSymlink(src: string, dest: string, type?: SymlinkType): Promise<void>;
  createSymlinkSync(src: string, dest: string, type?: SymlinkType): void;
  outputFile(
    file: string,
    data: WriteFileData,
    options?: import('node:fs').WriteFileOptions
  ): Promise<void>;
  outputFileSync(
    file: string,
    data: WriteFileData,
    options?: import('node:fs').WriteFileOptions
  ): void;
  outputJson(
    file: string,
    data: any,
    options?: JsonWriteOptions
  ): Promise<void>;
  outputJsonSync(file: string, data: any, options?: JsonWriteOptions): void;
  outputJSON(
    file: string,
    data: any,
    options?: JsonWriteOptions
  ): Promise<void>;
  outputJSONSync(file: string, data: any, options?: JsonWriteOptions): void;
  readJson<T = any>(
    file: string,
    options?: JsonReadOptions | BufferEncoding
  ): Promise<T>;
  readJsonSync<T = any>(
    file: string,
    options?: JsonReadOptions | BufferEncoding
  ): T;
  readJSON<T = any>(
    file: string,
    options?: JsonReadOptions | BufferEncoding
  ): Promise<T>;
  readJSONSync<T = any>(
    file: string,
    options?: JsonReadOptions | BufferEncoding
  ): T;
  writeJson(file: string, data: any, options?: JsonWriteOptions): Promise<void>;
  writeJsonSync(file: string, data: any, options?: JsonWriteOptions): void;
  writeJSON(file: string, data: any, options?: JsonWriteOptions): Promise<void>;
  writeJSONSync(file: string, data: any, options?: JsonWriteOptions): void;
  pathExists(path: PathLike): Promise<boolean>;
  pathExistsSync(path: PathLike): boolean;
  /** A no-op kept for fs-extra compatibility: returns `fs` unchanged. */
  gracefulify<T>(fs: T): T;
}

/** node:fs `glob`, resolving to an array instead of an async iterator. */
export interface FsGlob {
  (
    pattern: string | readonly string[],
    options: import('node:fs').GlobOptionsWithFileTypes
  ): Promise<Dirent[]>;
  (
    pattern: string | readonly string[],
    options?: import('node:fs').GlobOptionsWithoutFileTypes
  ): Promise<string[]>;
}

/**
 * Every node:fs export, with the callback functions also returning a promise
 * when the callback is omitted, plus the fs-extra helpers.
 */
export interface Fs
  extends
    Omit<NodeFs, UniversalFsName | 'exists' | 'glob'>,
    UniversalFs,
    FsExtra {
  exists: ((path: PathLike) => Promise<boolean>) & NodeFs['exists'];
  glob: FsGlob & NodeFs['glob'];
}

export declare const fs: Fs;

// ---------------------------------------------------------------------------
// glob (globby 14 compatible)
// ---------------------------------------------------------------------------

export interface GlobOptions {
  absolute?: boolean;
  baseNameMatch?: boolean;
  braceExpansion?: boolean;
  caseSensitiveMatch?: boolean;
  cwd?: string | URL;
  deep?: number;
  dot?: boolean;
  expandDirectories?:
    | boolean
    | readonly string[]
    | { files?: readonly string[]; extensions?: readonly string[] };
  extglob?: boolean;
  followSymbolicLinks?: boolean;
  gitignore?: boolean;
  ignore?: readonly string[];
  ignoreFiles?: string | readonly string[];
  markDirectories?: boolean;
  objectMode?: boolean;
  onlyDirectories?: boolean;
  onlyFiles?: boolean;
  stats?: boolean;
  suppressErrors?: boolean;
  throwErrorOnBrokenSymbolicLink?: boolean;
  unique?: boolean;
}

/** An `objectMode` / `stats` result. */
export interface GlobEntry {
  name: string;
  path: string;
  dirent: Dirent;
  stats?: Stats;
}

export interface GlobTask {
  patterns: string[];
  options: GlobOptions;
}

export type GlobPatterns = string | readonly string[];

type GlobResult<O> = O extends { objectMode: true } | { stats: true }
  ? GlobEntry
  : string;

export type GitIgnoreOptions = { cwd?: string | URL };

export interface Glob {
  <O extends GlobOptions = {}>(
    patterns: GlobPatterns,
    options?: O
  ): Promise<Array<GlobResult<O>>>;
  globby<O extends GlobOptions = {}>(
    patterns: GlobPatterns,
    options?: O
  ): Promise<Array<GlobResult<O>>>;
  sync<O extends GlobOptions = {}>(
    patterns: GlobPatterns,
    options?: O
  ): Array<GlobResult<O>>;
  globbySync<O extends GlobOptions = {}>(
    patterns: GlobPatterns,
    options?: O
  ): Array<GlobResult<O>>;
  globbyStream(patterns: GlobPatterns, options?: GlobOptions): Readable;
  stream(patterns: GlobPatterns, options?: GlobOptions): Readable;
  generateGlobTasks(
    patterns: GlobPatterns,
    options?: GlobOptions
  ): Promise<GlobTask[]>;
  generateGlobTasksSync(
    patterns: GlobPatterns,
    options?: GlobOptions
  ): GlobTask[];
  isDynamicPattern(patterns: GlobPatterns, options?: GlobOptions): boolean;
  isGitIgnored(options?: GitIgnoreOptions): Promise<(path: string) => boolean>;
  isGitIgnoredSync(options?: GitIgnoreOptions): (path: string) => boolean;
  isIgnoredByIgnoreFiles(
    patterns: GlobPatterns,
    options?: GitIgnoreOptions
  ): Promise<(path: string) => boolean>;
  isIgnoredByIgnoreFilesSync(
    patterns: GlobPatterns,
    options?: GitIgnoreOptions
  ): (path: string) => boolean;
  convertPathToPattern(source: string): string;
  globToRegExp(pattern: string, options?: GlobOptions): RegExp;
}

export declare const glob: Glob;
export { glob as globby };

// ---------------------------------------------------------------------------
// minimist
// ---------------------------------------------------------------------------

/** Parse command line arguments. */
export declare function minimist(
  args?: string[],
  opts?: minimist.Opts
): minimist.ParsedArgs;

export declare namespace minimist {
  interface Opts {
    /** Names always treated as strings. */
    string?: string | string[];
    /** Names treated as booleans; `true` makes every `--flag` boolean. */
    boolean?: boolean | string | string[];
    alias?: { [key: string]: string | string[] };
    default?: { [key: string]: any };
    /** Stop at the first positional argument. */
    stopEarly?: boolean;
    /** Collect everything after `--` in `argv['--']`. */
    '--'?: boolean;
    /** Return `false` to drop an unknown argument. */
    unknown?: (arg: string) => boolean;
  }

  interface ParsedArgs {
    [arg: string]: any;
    '--'?: string[];
    /** Positional arguments; numeric ones are parsed as numbers. */
    _: Array<string | number>;
  }
}

// ---------------------------------------------------------------------------
// dotenv
// ---------------------------------------------------------------------------

export declare namespace dotenv {
  /** Parse `.env` content. */
  function parse(content: string | Buffer): Record<string, string>;
  /** Serialize variables as `.env` content. */
  function stringify(env: Record<string, string | undefined>): string;
  /** Read and merge `.env` files; throws when one is missing. */
  function load(...files: string[]): Record<string, string>;
  /** Like `load`, skipping missing files. */
  function loadSafe(...files: string[]): Record<string, string>;
  /** `loadSafe` (default `.env`) and copy unset keys into `process.env`. */
  function config(file?: string, ...files: string[]): Record<string, string>;
}

// ---------------------------------------------------------------------------
// YAML (yaml 2 compatible)
// ---------------------------------------------------------------------------

export declare namespace YAML {
  type Range = [number, number, number];

  type LogLevel = 'silent' | 'error' | 'warn' | 'debug';

  interface ParseOptions {
    /** Keep the source position (`range`) of nodes. */
    keepSourceTokens?: boolean;
    lineCounter?: LineCounter;
    prettyErrors?: boolean;
    strict?: boolean;
    uniqueKeys?: boolean;
  }

  interface DocumentOptions {
    logLevel?: LogLevel;
    version?: '1.1' | '1.2' | 'next';
    merge?: boolean;
    intAsBigInt?: boolean;
  }

  interface SchemaOptions {
    schema?: 'core' | 'failsafe' | 'json' | 'yaml-1.1' | string;
    customTags?: unknown[];
    merge?: boolean;
    sortMapEntries?: boolean | ((a: Pair, b: Pair) => number);
    toStringDefaults?: ToStringOptions;
  }

  interface CreateNodeOptions {
    aliasDuplicateObjects?: boolean;
    anchorPrefix?: string;
    flow?: boolean;
    keepUndefined?: boolean;
    tag?: string;
  }

  interface ToJSOptions {
    mapAsMap?: boolean;
    maxAliasCount?: number;
    onAnchor?: (value: unknown, count: number) => void;
    reviver?: Reviver;
  }

  interface ToStringOptions {
    blockQuote?: boolean | 'folded' | 'literal';
    collectionStyle?: 'any' | 'block' | 'flow';
    commentString?: (comment: string) => string;
    defaultKeyType?: Scalar.Type | null;
    defaultStringType?: Scalar.Type;
    directives?: boolean | null;
    doubleQuotedAsJSON?: boolean;
    doubleQuotedMinMultiLineLength?: number;
    falseStr?: string;
    flowCollectionPadding?: boolean;
    indent?: number;
    indentSeq?: boolean;
    lineWidth?: number;
    minContentWidth?: number;
    nullStr?: string;
    simpleKeys?: boolean;
    singleQuote?: boolean | null;
    trueStr?: string;
  }

  type Options = ParseOptions &
    DocumentOptions &
    SchemaOptions &
    CreateNodeOptions &
    ToJSOptions &
    ToStringOptions;

  type Reviver = (key: unknown, value: unknown) => unknown;
  type Replacer = ((key: any, value: any) => unknown) | Array<string | number>;

  type ErrorCode = string;

  class YAMLError extends Error {
    name: 'YAMLParseError' | 'YAMLWarning';
    code: ErrorCode;
    message: string;
    pos: [number, number];
    linePos?: [LinePos] | [LinePos, LinePos];
    constructor(
      name: YAMLError['name'],
      pos: [number, number],
      code: ErrorCode,
      message: string
    );
  }

  class YAMLParseError extends YAMLError {
    constructor(pos: [number, number], code: ErrorCode, message: string);
  }

  class YAMLWarning extends YAMLError {
    constructor(pos: [number, number], code: ErrorCode, message: string);
  }

  interface LinePos {
    line: number;
    col: number;
  }

  class LineCounter {
    lineStarts: number[];
    addNewLine: (offset: number) => number;
    linePos: (offset: number) => LinePos;
  }

  abstract class NodeBase {
    comment?: string | null;
    commentBefore?: string | null;
    range?: Range | null;
    spaceBefore?: boolean;
    tag?: string;
    clone(schema?: Schema): NodeBase;
    toJS(doc: Document, options?: ToJSOptions): any;
  }

  class Scalar<T = unknown> extends NodeBase {
    static readonly BLOCK_FOLDED = 'BLOCK_FOLDED';
    static readonly BLOCK_LITERAL = 'BLOCK_LITERAL';
    static readonly PLAIN = 'PLAIN';
    static readonly QUOTE_DOUBLE = 'QUOTE_DOUBLE';
    static readonly QUOTE_SINGLE = 'QUOTE_SINGLE';
    value: T;
    type?: Scalar.Type;
    format?: string;
    source?: string;
    constructor(value: T);
    toJSON(arg?: any, ctx?: any): any;
    toString(): string;
  }

  namespace Scalar {
    type Type =
      | 'BLOCK_FOLDED'
      | 'BLOCK_LITERAL'
      | 'PLAIN'
      | 'QUOTE_DOUBLE'
      | 'QUOTE_SINGLE';
  }

  class Alias extends NodeBase {
    source: string;
    constructor(source: string);
    resolve(doc: Document): Scalar | YAMLMap | YAMLSeq | undefined;
    toJSON(arg?: unknown, ctx?: unknown): unknown;
    toString(): string;
  }

  class Pair<K = unknown, V = unknown> {
    key: K;
    value: V | null;
    constructor(key: K, value?: V | null);
    clone(schema?: Schema): Pair<K, V>;
    toJSON(_?: unknown, ctx?: unknown): any;
    toString(): string;
  }

  type Node = Alias | Scalar | YAMLMap | YAMLSeq;
  type ParsedNode = Node;

  abstract class Collection extends NodeBase {
    items: unknown[];
    flow?: boolean;
    schema?: Schema;
    addIn(path: Iterable<unknown>, value: unknown): void;
    deleteIn(path: Iterable<unknown>): boolean;
    getIn(path: Iterable<unknown>, keepScalar?: boolean): unknown;
    hasIn(path: Iterable<unknown>): boolean;
    setIn(path: Iterable<unknown>, value: unknown): void;
    toString(
      ctx?: unknown,
      onComment?: () => void,
      onChompKeep?: () => void
    ): string;
  }

  class YAMLMap<K = unknown, V = unknown> extends Collection {
    static get tagName(): 'tag:yaml.org,2002:map';
    static from(schema: Schema, obj: unknown, ctx: unknown): YAMLMap;
    items: Array<Pair<K, V>>;
    constructor(schema?: Schema);
    add(pair: Pair<K, V> | { key: K; value: V }, overwrite?: boolean): void;
    delete(key: unknown): boolean;
    get(key: unknown, keepScalar?: boolean): unknown;
    has(key: unknown): boolean;
    set(key: K, value: V): void;
    toJSON<T = unknown>(_?: unknown, ctx?: unknown, Type?: { new (): T }): any;
  }

  class YAMLSeq<T = unknown> extends Collection {
    static get tagName(): 'tag:yaml.org,2002:seq';
    static from(schema: Schema, obj: unknown, ctx: unknown): YAMLSeq;
    items: T[];
    constructor(schema?: Schema);
    add(value: T): void;
    delete(key: unknown): boolean;
    get(key: unknown, keepScalar?: boolean): unknown;
    has(key: unknown): boolean;
    set(key: unknown, value: T): void;
    toJSON(_?: unknown, ctx?: unknown): unknown[];
  }

  class Schema {
    name: string;
    merge: boolean;
    knownTags: Record<string, unknown>;
    tags: unknown[];
    sortMapEntries: ((a: Pair, b: Pair) => number) | null;
    toStringOptions: ToStringOptions | null;
    constructor(options: SchemaOptions);
    clone(): Schema;
  }

  interface Directives {
    docStart: true | null;
    docEnd: boolean;
    yaml: { version: '1.1' | '1.2' | 'next'; explicit?: boolean };
    tags: Record<string, string>;
  }

  class Document<T = unknown> {
    options: Required<DocumentOptions> & ParseOptions;
    contents: T | null;
    comment: string | null;
    commentBefore: string | null;
    directives: Directives | undefined;
    errors: YAMLError[];
    warnings: YAMLWarning[];
    range: Range;
    schema: Schema;
    constructor(value?: any, options?: Options);
    constructor(value: any, replacer: null | Replacer, options?: Options);
    clone(): Document<T>;
    add(value: any): void;
    addIn(path: Iterable<unknown>, value: unknown): void;
    createAlias(node: Scalar | YAMLMap | YAMLSeq, name?: string): Alias;
    createNode(value: unknown, options?: CreateNodeOptions): Node;
    createNode(
      value: unknown,
      replacer: Replacer | CreateNodeOptions | null,
      options?: CreateNodeOptions
    ): Node;
    createPair<K = unknown, V = unknown>(
      key: unknown,
      value: unknown,
      options?: CreateNodeOptions
    ): Pair<K, V>;
    delete(key: unknown): boolean;
    deleteIn(path: Iterable<unknown> | null): boolean;
    get(key: unknown, keepScalar?: boolean): unknown;
    getIn(path: Iterable<unknown> | null, keepScalar?: boolean): unknown;
    has(key: unknown): boolean;
    hasIn(path: Iterable<unknown> | null): boolean;
    set(key: any, value: unknown): void;
    setIn(path: Iterable<unknown> | null, value: unknown): void;
    setSchema(
      version: '1.1' | '1.2' | 'next' | null,
      options?: SchemaOptions
    ): void;
    toJS(opt?: ToJSOptions & { json?: boolean; jsonArg?: string | null }): any;
    toJSON(jsonArg?: string | null, onAnchor?: ToJSOptions['onAnchor']): any;
    toString(options?: ToStringOptions): string;
  }

  /** Result of `parseAllDocuments`; `empty` is set when there are none. */
  type DocumentList = Document[] & { empty?: true };

  class Lexer {
    lex(source: string, incomplete?: boolean): Generator<string>;
  }

  class Parser {
    constructor(onNewLine?: (offset: number) => void);
    parse(source: string, incomplete?: boolean): Generator<any>;
  }

  class Composer {
    constructor(options?: Options);
    compose(
      tokens: Iterable<any>,
      forceDoc?: boolean,
      endOffset?: number
    ): Generator<Document>;
    next(token: any): Generator<Document>;
    end(forceDoc?: boolean, endOffset?: number): Generator<Document>;
  }

  /** Token-level helpers (frozen object). */
  const CST: {
    readonly BOM: string;
    readonly DOCUMENT: string;
    readonly FLOW_END: string;
    readonly SCALAR: string;
    isCollection(token: unknown): boolean;
    isScalar(token: unknown): boolean;
    stringify(cst: unknown): string;
    visit(cst: unknown, visitor: unknown): void;
  };

  function isAlias(node: unknown): node is Alias;
  function isCollection(node: unknown): node is YAMLMap | YAMLSeq;
  function isDocument(node: unknown): node is Document;
  function isMap(node: unknown): node is YAMLMap;
  function isNode(node: unknown): node is Node;
  function isPair(node: unknown): node is Pair;
  function isScalar(node: unknown): node is Scalar;
  function isSeq(node: unknown): node is YAMLSeq;

  type VisitorResult = number | symbol | Node | Pair | void;

  type visitorFn<T> = (
    key: number | 'key' | 'value' | null,
    node: T,
    path: ReadonlyArray<Document | Node | Pair>
  ) => VisitorResult | Promise<VisitorResult>;

  type Visitor =
    | visitorFn<unknown>
    | {
        Alias?: visitorFn<Alias>;
        Collection?: visitorFn<YAMLMap | YAMLSeq>;
        Map?: visitorFn<YAMLMap>;
        Node?: visitorFn<Node>;
        Pair?: visitorFn<Pair>;
        Scalar?: visitorFn<Scalar>;
        Seq?: visitorFn<YAMLSeq>;
        Value?: visitorFn<Scalar | YAMLMap | YAMLSeq>;
      };

  interface VisitControl {
    readonly BREAK: symbol;
    readonly SKIP: symbol;
    readonly REMOVE: symbol;
  }

  const visit: ((node: Node | Document | null, visitor: Visitor) => void) &
    VisitControl;
  const visitAsync: ((
    node: Node | Document | null,
    visitor: Visitor
  ) => Promise<void>) &
    VisitControl;

  function parse(src: string, options?: Options): any;
  function parse(src: string, reviver: Reviver, options?: Options): any;
  function parseDocument<T = unknown>(
    source: string,
    options?: Options
  ): Document<T>;
  function parseAllDocuments(source: string, options?: Options): DocumentList;
  /** `undefined` for an `undefined` value (unless `keepUndefined`). */
  function stringify(
    value: any,
    options?: Options | number | string
  ): string | undefined;
  function stringify(
    value: any,
    replacer?: Replacer | null,
    options?: Options | number | string
  ): string | undefined;
}

// ---------------------------------------------------------------------------
// MAML
// ---------------------------------------------------------------------------

export declare namespace MAML {
  /** Parse a MAML document. */
  function parse(source: string): any;
  /** Serialize a value as a MAML document. */
  function stringify(value: unknown): string;
}

// ---------------------------------------------------------------------------
// goods (src/zx/goods.mjs)
// ---------------------------------------------------------------------------

/** Versions of zx and of the bundled helper libraries this API mirrors. */
export declare const versions: {
  zx: string;
  chalk: string;
  depseek: string;
  dotenv: string;
  fetch: string;
  fs: string;
  glob: string;
  minimist: string;
  ps: string;
  which: string;
  yaml: string;
};

/** Create a temporary directory and return its path. */
export declare function tempdir(prefix?: string, mode?: Mode): string;
/** Create a temporary file (optionally with `data`) and return its path. */
export declare function tempfile(
  name?: string,
  data?: string | Buffer,
  mode?: Mode
): string;
export { tempdir as tmpdir, tempfile as tmpfile };

/** `minimist` options plus key camel-casing and `"true"`/`"false"` parsing. */
export type ArgvOpts = minimist.Opts & {
  camelCase?: boolean;
  parseBoolean?: boolean;
};

export declare const parseArgv: (
  args?: string[],
  opts?: ArgvOpts,
  defs?: Record<string, any>
) => minimist.ParsedArgs;

/** Re-parse `argv` in place. */
export declare function updateArgv(args?: string[], opts?: ArgvOpts): void;

/** `process.argv.slice(2)`, parsed. */
export declare const argv: minimist.ParsedArgs;

export declare function sleep(duration: Duration): Promise<void>;

/** `fetch` that logs in verbose mode and can pipe the body into a command. */
export declare function fetch(
  url: RequestInfo,
  init?: RequestInit
): Promise<Response> & {
  pipe: {
    (dest: TemplateStringsArray, ...args: any[]): ProcessPromise;
    <D>(dest: D): D;
  };
};

/** Print to stdout; accepts a template literal or plain arguments. */
export declare function echo(...args: any[]): void;

export declare function question(
  query?: string,
  options?: {
    choices?: string[];
    input?: NodeJS.ReadStream;
    output?: NodeJS.WriteStream;
  }
): Promise<string>;

/** Read a whole stream (stdin by default) as a string. */
export declare function stdin(stream?: Readable): Promise<string>;

export declare function retry<T>(count: number, callback: () => T): Promise<T>;
export declare function retry<T>(
  count: number,
  duration: Duration | Generator<number>,
  callback: () => T
): Promise<T>;

export declare function expBackoff(
  max?: Duration,
  delay?: Duration
): Generator<number, void, unknown>;

export declare function spinner<T>(callback: () => T): Promise<T>;
export declare function spinner<T>(
  title: string,
  callback: () => T
): Promise<T>;

// ---------------------------------------------------------------------------
// index (src/zx/index.mjs)
// ---------------------------------------------------------------------------

export declare const VERSION: string;
export declare const version: string;

/** @deprecated Use $`cmd`.nothrow() instead. */
export declare function nothrow(promise: ProcessPromise): ProcessPromise;

/** @deprecated Use $`cmd`.quiet() instead. */
export declare function quiet(promise: ProcessPromise): ProcessPromise;
