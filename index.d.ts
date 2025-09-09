/**
 * TypeScript definitions for command-stream
 * Modern $ shell utility library with streaming, async iteration, and EventEmitter support
 */

import { Readable, Writable } from 'stream';
import { ChildProcess } from 'child_process';

// Base interfaces
export interface CommandResult {
  /** Exit code of the command */
  code: number;
  /** Standard output as string */
  stdout: string;
  /** Standard error as string */
  stderr: string;
  /** Standard input that was provided */
  stdin: string;
  /** Get stdout as text (async method) */
  text(): Promise<string>;
}

export interface ProcessOptions {
  /** Mirror output to console (default: true) */
  mirror?: boolean;
  /** Capture output for result (default: true) */
  capture?: boolean;
  /** Standard input handling */
  stdin?: 'inherit' | 'pipe' | string | Buffer;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Enable interactive TTY forwarding */
  interactive?: boolean;
  /** Enable shell operator parsing (default: true) */
  shellOperators?: boolean;
}

export interface StreamOptions {
  /** Standard input handling */
  stdin?: 'inherit' | 'pipe';
  /** Standard output handling */
  stdout?: 'inherit' | 'pipe';
  /** Standard error handling */
  stderr?: 'inherit' | 'pipe';
}

// Event types for StreamEmitter
export interface StreamEvents {
  data: [Buffer];
  end: [CommandResult];
  error: [Error];
  close: [number];
}

// Virtual command handler type
export type VirtualCommandHandler = (args: string[], options: ProcessOptions) => Promise<CommandResult> | CommandResult | AsyncIterable<Buffer>;

// Stream interfaces
export interface ProcessStreams {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
}

// Core ProcessRunner class with proper typing
export declare class ProcessRunner {
  constructor(spec: { mode: string; command: string }, options?: ProcessOptions);
  
  // Stream properties
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly stdin: Writable | null;
  
  // New streaming interfaces
  readonly streams: ProcessStreams;
  
  // EventEmitter-like interface
  on<K extends keyof StreamEvents>(event: K, listener: (...args: StreamEvents[K]) => void): this;
  once<K extends keyof StreamEvents>(event: K, listener: (...args: StreamEvents[K]) => void): this;
  emit<K extends keyof StreamEvents>(event: K, ...args: StreamEvents[K]): boolean;
  off<K extends keyof StreamEvents>(event: K, listener: (...args: StreamEvents[K]) => void): this;
  
  // Core methods
  start(options?: { mode?: 'async' | 'sync' } & StreamOptions): this;
  cancel(signal?: NodeJS.Signals): void;
  
  // Async iteration support
  stream(): AsyncIterable<Buffer>;
  
  // Promise interface
  then<TResult1 = CommandResult, TResult2 = never>(
    onfulfilled?: ((value: CommandResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
  
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<CommandResult | TResult>;
  
  finally(onfinally?: (() => void) | null): Promise<CommandResult>;
}

// Main $ function interfaces
export interface $Function {
  // Tagged template usage: $`command`
  (strings: TemplateStringsArray, ...values: any[]): ProcessRunner;
  
  // Options usage: $({ option: value })`command`
  (options: ProcessOptions): (strings: TemplateStringsArray, ...values: any[]) => ProcessRunner;
}

// Shell execution functions
export declare function sh(command: string, options?: ProcessOptions): ProcessRunner;
export declare function exec(command: string, options?: ProcessOptions): ProcessRunner;
export declare function run(command: string, options?: ProcessOptions): ProcessRunner;

// Factory function
export declare function create(defaultOptions?: ProcessOptions): $Function;

// Utility functions
export declare function quote(value: any): string;
export declare function raw(value: any): { [Symbol.toPrimitive](): string };

// Global state management
export declare function set(option: string): void;
export declare function unset(option: string): void;
export declare function resetGlobalState(): void;
export declare function forceCleanupAll(): void;

// Virtual commands system with type safety
export declare function register<TArgs extends readonly string[] = string[]>(
  name: string, 
  handler: VirtualCommandHandler
): void;

export declare function unregister(name: string): boolean;
export declare function listCommands(): string[];
export declare function enableVirtualCommands(): void;
export declare function disableVirtualCommands(): void;

// ANSI utilities
export interface AnsiConfig {
  enabled?: boolean;
  colors?: boolean;
  styles?: boolean;
}

export declare const AnsiUtils: {
  strip(text: string): string;
  hasAnsi(text: string): boolean;
};

export declare function configureAnsi(options?: AnsiConfig): void;
export declare function getAnsiConfig(): Required<AnsiConfig>;
export declare function processOutput(data: string | Buffer, options?: AnsiConfig): string;

// Shell detection and utilities
export declare const shell: {
  cmd: string;
  args: string[];
};

// Main exports
export declare const $: $Function;
export default $;

// Type-safe pipeline definitions
export type PipelineStep<T = any> = ProcessRunner | ((input: T) => ProcessRunner);
export type Pipeline<T = any> = PipelineStep<T>[];

// Generic streaming support
export interface StreamingOptions<T = Buffer> {
  transform?: (chunk: Buffer) => T;
  encoding?: BufferEncoding;
}

// Enhanced ProcessRunner with generics for streaming
declare module './src/$.mjs' {
  interface ProcessRunner {
    stream<T = Buffer>(options?: StreamingOptions<T>): AsyncIterable<T>;
  }
}

// Template expression type for advanced usage
export type TemplateExpression = string | number | boolean | null | undefined | Buffer | 
  { toString(): string } | { [Symbol.toPrimitive](hint: 'string'): string };

// Virtual command registration with better typing
export interface TypedVirtualCommand<TArgs extends readonly unknown[] = unknown[]> {
  name: string;
  handler: (...args: TArgs) => Promise<CommandResult> | CommandResult | AsyncIterable<Buffer>;
}

export declare function registerTyped<TArgs extends readonly unknown[]>(
  command: TypedVirtualCommand<TArgs>
): void;

// Event type definitions for full IDE support
export type CommandEventMap = {
  'data': Buffer;
  'stdout': Buffer;
  'stderr': Buffer;
  'end': CommandResult;
  'error': Error;
  'close': number;
  'start': void;
  'cancel': NodeJS.Signals;
};

// Extend ProcessRunner with properly typed events
declare module './src/$.mjs' {
  interface ProcessRunner {
    on<K extends keyof CommandEventMap>(event: K, listener: (data: CommandEventMap[K]) => void): this;
    once<K extends keyof CommandEventMap>(event: K, listener: (data: CommandEventMap[K]) => void): this;
    emit<K extends keyof CommandEventMap>(event: K, data: CommandEventMap[K]): boolean;
    off<K extends keyof CommandEventMap>(event: K, listener: (data: CommandEventMap[K]) => void): this;
  }
}