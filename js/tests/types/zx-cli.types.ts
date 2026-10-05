/**
 * Compile-only tests for `command-stream/zx/cli` (`types/zx-cli.d.ts`).
 */

import {
  argv,
  autorun,
  injectGlobalRequire,
  isMain,
  main,
  normalizeExt,
  printUsage,
  transformMarkdown,
} from 'command-stream/zx/cli';
import * as cli from 'command-stream/zx/cli';
import { expectType, use, type Equal } from './helpers.cjs';

export async function cliHelpers(): Promise<void> {
  const positional: Array<string | number> = argv._;
  const flag: unknown = argv['quiet'];
  autorun(import.meta);
  const entry: boolean = isMain(import.meta) || isMain('file:///x.mjs', '/x');
  expectType<Equal<ReturnType<typeof main>, Promise<void>>>();
  const ext: string | undefined = normalizeExt('mjs');
  const script: string = transformMarkdown(Buffer.from('# title'));
  injectGlobalRequire(import.meta.url);
  printUsage();

  // zx's internal runner helpers are not exported.
  // @ts-expect-error - not exported
  use(cli.runScript);
  // @ts-expect-error - not exported
  use(cli.readScript);

  use(positional, flag, entry, ext, script);
}
