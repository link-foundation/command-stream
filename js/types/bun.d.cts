/**
 * TypeScript declarations for `command-stream/bun`, the Bun.$-compatible
 * shell. They mirror Bun's own `bun-types/shell.d.ts`, so code typed against
 * `import { $ } from 'bun'` type checks unchanged against this module.
 *
 * Shared by the ES module (`bun.d.ts`) and CommonJS (`require`) entry points.
 */

/// <reference types="node" />

import type { Readable, Writable } from 'node:stream';

/** A value interpolated into a shell template. */
export type ShellExpression =
  | { toString(): string }
  | ShellExpression[]
  | string
  | { raw: string }
  | ArrayBufferView
  | ArrayBuffer
  | Blob
  | Response
  | ReadableStream
  | Readable
  | Writable
  | ShellFile;

/** The result of a finished command. */
export interface ShellOutput {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number;
  /** stdout decoded with `encoding` (UTF-8 by default). */
  text(encoding?: BufferEncoding): string;
  /** stdout parsed as JSON. */
  json(): any;
  arrayBuffer(): ArrayBuffer;
  bytes(): Uint8Array;
  blob(): Blob;
}

export declare const ShellOutput: {
  new (stdout: Buffer, stderr: Buffer, exitCode: number): ShellOutput;
  readonly prototype: ShellOutput;
};

/** Thrown (rejected) when a command exits non-zero in throwing mode. */
export declare class ShellError extends Error implements ShellOutput {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number;
  readonly info: { exitCode: number; stdout: Buffer; stderr: Buffer };
  text(encoding?: BufferEncoding): string;
  json(): any;
  arrayBuffer(): ArrayBuffer;
  bytes(): Uint8Array;
  blob(): Blob;
}

/**
 * A command that runs once awaited, or once an output method such as
 * `.text()` is called.
 */
export declare class ShellPromise extends Promise<ShellOutput> {
  /** Working directory of the command. */
  cwd(newCwd: string): this;
  /** Replace the environment of the command. */
  env(
    newEnv: Record<string, string | undefined> | NodeJS.ProcessEnv | undefined
  ): this;
  /** Prefer project-local executables (command-stream extension). */
  preferLocal(value?: boolean | string | string[]): this;
  /** Only buffer the output, without echoing it to stdout/stderr. */
  quiet(isQuiet?: boolean): this;
  /** stdout, line by line (implies `quiet()`). */
  lines(): AsyncIterable<string>;
  /** stdout as a string (implies `quiet()`). */
  text(encoding?: BufferEncoding): Promise<string>;
  /** stdout parsed as JSON (implies `quiet()`). */
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  blob(): Promise<Blob>;
  /** Resolve instead of rejecting on non-zero exit codes. */
  nothrow(): this;
  throws(shouldThrow: boolean): this;
  /** Start the command without awaiting it. */
  run(): this;
}

/** A file reference (`$.file(path)`), the portable `Bun.file(path)`. */
export declare class ShellFile {
  constructor(path: string | URL);
  readonly name: string;
  readonly size: number;
  exists(): Promise<boolean>;
  bytes(): Promise<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<any>;
  toString(): string;
}

/** The Bun.$ tagged template, with Bun's static helpers. */
export interface BunShell {
  (
    strings: TemplateStringsArray,
    ...expressions: ShellExpression[]
  ): ShellPromise;
  /** Default environment for commands created by this shell. */
  env(
    newEnv?: Record<string, string | undefined> | NodeJS.ProcessEnv
  ): BunShell;
  /** Default working directory for commands created by this shell. */
  cwd(newCwd?: string): BunShell;
  /** Prefer project-local executables by default (command-stream extension). */
  preferLocal(value?: boolean | string | string[]): BunShell;
  nothrow(): BunShell;
  throws(shouldThrow: boolean): BunShell;
  /** Bash-like brace expansion: `braces('a{1,2}')` is `['a1', 'a2']`. */
  braces(pattern: string): string[];
  /** Quote a string for safe use inside a shell script. */
  escape(input: string): string;
  /** A file reference, interpolated as its path. */
  file(path: string | URL): ShellFile;
  /** `new $.Shell()`: an independent `$` with its own cwd/env/throws. */
  readonly Shell: new () => BunShell;
  readonly ShellPromise: typeof ShellPromise;
  readonly ShellError: typeof ShellError;
}

export declare const $: BunShell;
export declare const Shell: new () => BunShell;
export default $;
