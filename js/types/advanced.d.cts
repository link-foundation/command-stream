import type {
  Dollar,
  ProcessOptions,
  ProcessRunner,
  StreamResult,
  StreamChunk,
  VirtualCommandContext,
  VirtualCommandResult,
  VirtualCommandChunk,
  TerminalFrame,
} from './api.cjs';
import type { REPLServer } from 'node:repl';
import type { Readable, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';

export class CommandBuilder<T = StreamResult> implements PromiseLike<T> {
  constructor(
    file: string,
    args?: readonly string[],
    options?: ProcessOptions,
    select?: (result: StreamResult) => T
  );
  readonly file: string;
  readonly args: readonly string[];
  readonly options: Readonly<ProcessOptions>;
  with(options: ProcessOptions): CommandBuilder<T>;
  pipe<A>(
    a: (builder: CommandBuilder<T>) => CommandBuilder<A>
  ): CommandBuilder<A>;
  pipe<A, B>(
    a: (builder: CommandBuilder<T>) => CommandBuilder<A>,
    b: (builder: CommandBuilder<A>) => CommandBuilder<B>
  ): CommandBuilder<B>;
  pipe(
    ...transforms: Array<(builder: CommandBuilder<any>) => CommandBuilder<any>>
  ): CommandBuilder<any>;
  runner(): ProcessRunner;
  run(): Promise<T>;
  then<R1 = T, R2 = never>(
    resolve?: ((value: T) => R1 | PromiseLike<R1>) | null,
    reject?: ((error: any) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2>;
  stream(options?: StreamOptions): CommandStream;
  toString(): string;
}
export interface CommandFactory {
  (file: string, ...args: string[]): CommandBuilder;
  stdout(
    mode: 'pipe' | 'inherit' | 'ignore'
  ): <T>(builder: CommandBuilder<T>) => CommandBuilder<T>;
  stderr(
    mode: 'pipe' | 'inherit' | 'ignore'
  ): <T>(builder: CommandBuilder<T>) => CommandBuilder<T>;
  cwd(path: string): <T>(builder: CommandBuilder<T>) => CommandBuilder<T>;
  env(
    env: NodeJS.ProcessEnv
  ): <T>(builder: CommandBuilder<T>) => CommandBuilder<T>;
  stdin(
    stdin: ProcessOptions['stdin']
  ): <T>(builder: CommandBuilder<T>) => CommandBuilder<T>;
  exitCode(builder: CommandBuilder<any>): CommandBuilder<number>;
}
export const command: CommandFactory;
export function fy(
  source: string,
  options?: { shell?: string; name?: string; module?: string }
): string;
export interface StreamOptions {
  highWaterMark?: number;
  highWaterBytes?: number;
}
export interface StreamStats {
  count: number;
  errors: number;
  errorRate: number;
  elapsed: number;
  throughput?: number;
  responseTime: { count: number; mean: number; min: number; max: number };
}
export interface AnalyzeOptions<T> {
  errorRate?: (value: T) => boolean | Promise<boolean>;
  responseTime?: (value: T) => number | Promise<number>;
  throughput?: boolean;
  onUpdate?: (stats: StreamStats) => void | Promise<void>;
  now?: () => number;
}
export class StreamPipeline<T> implements AsyncIterableIterator<T> {
  constructor(factory: () => AsyncIterable<T>, commandOutput?: boolean);
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
  next(): Promise<IteratorResult<T>>;
  return(value?: unknown): Promise<IteratorResult<T>>;
  throw(error: unknown): Promise<IteratorResult<T>>;
  map<U>(fn: (value: T, index: number) => U | Promise<U>): StreamPipeline<U>;
  filter(
    fn: (value: T, index: number) => boolean | Promise<boolean>
  ): StreamPipeline<T>;
  reduce<U>(
    fn: (accumulator: U, value: T, index: number) => U | Promise<U>,
    initial: U
  ): Promise<U>;
  forEach(fn: (value: T, index: number) => void | Promise<void>): Promise<void>;
  toArray(): Promise<T[]>;
  batch(size: number): StreamPipeline<T[]>;
  window(size: number, step?: number): StreamPipeline<T[]>;
  take(count: number): StreamPipeline<T>;
  lines(options?: { stderr?: boolean }): StreamPipeline<string>;
  split(
    predicate: (value: T) => boolean | Promise<boolean>,
    options?: StreamOptions
  ): [StreamPipeline<T>, StreamPipeline<T>];
  analyze(options?: AnalyzeOptions<T>): Promise<StreamStats>;
}
/** Raw iteration retains chunks; fluent processing consumes stdout lines. */
export type CommandStream = Omit<
  StreamPipeline<StreamChunk>,
  | 'map'
  | 'filter'
  | 'batch'
  | 'window'
  | 'reduce'
  | 'forEach'
  | 'analyze'
  | 'split'
> &
  Pick<
    StreamPipeline<string>,
    | 'map'
    | 'filter'
    | 'batch'
    | 'window'
    | 'reduce'
    | 'forEach'
    | 'analyze'
    | 'split'
  >;
export function stream<T>(
  source: Iterable<T> | AsyncIterable<T>
): StreamPipeline<T>;
export function merge<T>(
  ...sources: Array<Iterable<T> | AsyncIterable<T>>
): StreamPipeline<T>;
export class TerminalBuffer extends EventEmitter {
  constructor(options?: {
    cols?: number;
    rows?: number;
    scrollback?: number;
    frameInterval?: number;
  });
  snapshot(): TerminalFrame;
  text(options?: { color?: boolean }): string;
  write(data: string | Uint8Array): Promise<void>;
  resize(cols: number, rows: number): void;
  flush(): Promise<void>;
  frames(): AsyncGenerator<TerminalFrame>;
  dispose(): void;
}
export type CommandHandler = (
  context: VirtualCommandContext
) =>
  | VirtualCommandResult
  | AsyncIterable<VirtualCommandChunk>
  | Iterable<VirtualCommandChunk>
  | Promise<
      | VirtualCommandResult
      | AsyncIterable<VirtualCommandChunk>
      | Iterable<VirtualCommandChunk>
    >;
export type CommandMiddleware = (
  context: VirtualCommandContext,
  next: (context?: VirtualCommandContext) => ReturnType<CommandHandler>
) => ReturnType<CommandHandler>;
export function extend(
  name: string,
  middleware: CommandMiddleware
): CommandHandler;
export function inherit(
  name: string,
  parent: string,
  defaults?: Partial<VirtualCommandContext>
): CommandHandler;
export function compose(...handlers: CommandHandler[]): CommandHandler;
export interface CommandPackage {
  name?: string;
  version?: string;
  commands: Record<string, CommandHandler>;
  descriptions?: Record<string, string>;
}
export interface InstalledPackage {
  name: string;
  version: string;
  file: string;
  handlers: Map<string, CommandHandler>;
  reload(): Promise<InstalledPackage>;
  uninstall(): void;
}
export function install(
  specifier: string,
  options?: {
    cwd?: string;
    install?: boolean;
    replace?: boolean;
    reload?: boolean;
  }
): Promise<InstalledPackage>;
export const marketplace: {
  search(
    query: string,
    options?: {
      registry?: string;
      fetch?: typeof fetch;
      size?: number;
      signal?: AbortSignal;
    }
  ): Promise<Array<{ name: string; version: string; description?: string }>>;
};
export interface DevOptions {
  watch?: string[];
  entry?: string | null;
  cwd?: string;
  repl?: boolean;
  packages?: InstalledPackage[];
  initial?: boolean;
  interval?: number;
  debounce?: number;
  onRestart?: (files: string[]) => void | Promise<void>;
  onError?: (error: Error) => void;
}
export interface DevController {
  ready: Promise<void>;
  close(): Promise<void>;
  repl: REPLServer | null;
  readonly child?: ProcessRunner;
}
export function dev(options?: DevOptions): DevController;
export function startRepl(options?: {
  input?: Readable;
  output?: Writable;
  terminal?: boolean;
  prompt?: string;
}): REPLServer & { commandNames(): string[] };
export interface DebugEvent {
  stage: string;
  count: number;
  time: number;
  duration: number;
  memory: number;
  value: string | number;
}
export class PipelineDebugger {
  constructor(options?: {
    paused?: boolean;
    history?: number;
    preview?: number;
  });
  timeline: DebugEvent[];
  errors: string[];
  serve(options?: {
    port?: number;
  }): Promise<{ url: string; close(): Promise<void> }>;
  step(): void;
  resume(): void;
  pause(): void;
  stage<T>(
    name: string,
    source: AsyncIterable<T> | Iterable<T>
  ): StreamPipeline<T>;
  visualize(): string;
  profile(): Array<{
    stage: string;
    count: number;
    duration: number;
    memory: number;
  }>;
}
export const testing: {
  withMocks<T>(
    mocks: Record<string, CommandHandler | VirtualCommandResult>,
    callback: (
      calls: Array<{ name: string; context: VirtualCommandContext }>
    ) => T | Promise<T>
  ): Promise<T>;
  expectOutput(
    result: StreamResult | PromiseLike<StreamResult>,
    expected: string,
    code?: number
  ): Promise<void>;
  expectPipeline<T>(
    source: Iterable<T> | AsyncIterable<T>,
    expected: T[]
  ): Promise<void>;
  snapshot(
    file: string,
    value: unknown,
    options?: { update?: boolean }
  ): Promise<void>;
};
