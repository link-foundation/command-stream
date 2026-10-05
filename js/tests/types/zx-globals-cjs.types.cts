/**
 * Compile-only tests for `require('command-stream/zx/globals')`
 * (`types/zx-globals.d.ts`).
 */

import globalsModule = require('command-stream/zx/globals');
import zx = require('command-stream/zx');
import helpers = require('./helpers.cjs');

type Equal<A, B> = helpers.Equal<A, B>;
const { expectType, use } = helpers;

export async function commonJsGlobals(): Promise<void> {
  // The module installs globals and exports nothing.
  expectType<Equal<keyof typeof globalsModule, never>>();
  expectType<Equal<typeof $, typeof zx.$>>();
  expectType<Equal<typeof globalThis.within, typeof zx.within>>();
  const out: ProcessOutput = await $`echo hi`;
  const exists: boolean = await fs.pathExists(__filename);

  use(out, exists);
}
