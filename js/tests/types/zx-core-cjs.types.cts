/**
 * Compile-only tests for `require('command-stream/zx/core')`
 * (`types/zx-core.d.cts`).
 */

import core = require('command-stream/zx/core');
import zx = require('command-stream/zx');
import helpers = require('./helpers.cjs');

type Equal<A, B> = helpers.Equal<A, B>;
const { expectType, use } = helpers;

export async function commonJsCore(): Promise<void> {
  expectType<Equal<typeof core.$, typeof zx.$>>();
  expectType<Equal<core.Options, zx.Options>>();
  const out: core.ProcessOutput = await core.$`echo hi`;
  const found: string = await core.which('node');
  const list: core.PsLookupEntry[] = await core.ps.lookup();

  // @ts-expect-error - glob is not part of the core entry
  use(core.glob);

  use(out, found, list);
}
