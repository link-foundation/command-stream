/**
 * TypeScript declarations for `command-stream/zx/cli` (CommonJS entry point,
 * re-exported by `zx-cli.d.ts`).
 *
 * The helpers behind the `zx` command line runner (`src/zx/cli.mjs`).
 */

/// <reference types="node" />

import type { minimist } from './zx-api.cjs';

/** The runner's own flags, parsed from `process.argv`. */
export declare const argv: minimist.ParsedArgs;

/** Print the runner's `--help` text. */
export declare function printUsage(): void;

/** Run the command line runner with `argv`. */
export declare function main(): Promise<void>;

/** Call `main()` when the calling module is the process entry point. */
export declare function autorun(meta?: ImportMeta): void;

/** Define a global `require` resolving relative to `origin`. */
export declare function injectGlobalRequire(origin: string): void;

/** Extract the code blocks of a Markdown script as runnable JavaScript. */
export declare function transformMarkdown(buf: Buffer | string): string;

/** Whether `meta` (or a file URL or path) is the process entry point. */
export declare function isMain(
  meta?: ImportMeta | string,
  scriptpath?: string
): boolean;

/** Normalize a script extension option to `.ext` form. */
export declare function normalizeExt(ext?: string): string | undefined;
