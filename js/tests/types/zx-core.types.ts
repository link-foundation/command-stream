/**
 * Compile-only tests for `command-stream/zx/core` (`types/zx-core.d.ts`).
 */

import * as zx from 'command-stream/zx';
import {
  $,
  Fail,
  ProcessOutput,
  ProcessPromise,
  bus,
  cd,
  chalk,
  defaults,
  kill,
  log,
  os,
  path,
  ps,
  quote,
  quotePowerShell,
  resolveDefaults,
  syncProcessCwd,
  useBash,
  usePowerShell,
  usePwsh,
  which,
  within,
  type Options,
  type Shell,
} from 'command-stream/zx/core';
import * as core from 'command-stream/zx/core';
import { expectType, use, type Equal } from './helpers.cjs';

export async function coreSubset(): Promise<void> {
  // The core entry re-exports the same declarations as the full entry.
  expectType<Equal<typeof $, typeof zx.$>>();
  expectType<Equal<typeof ProcessPromise, typeof zx.ProcessPromise>>();
  expectType<Equal<typeof ProcessOutput, typeof zx.ProcessOutput>>();
  expectType<Equal<Options, zx.Options>>();

  const p: ProcessPromise = $`echo hi`;
  const out: ProcessOutput = await p;
  const bound: Shell = $({ quiet: true });
  within(() => cd('/tmp'));
  const values = [
    Fail,
    bus,
    chalk,
    defaults,
    kill,
    log,
    os,
    path,
    ps,
    quote,
    quotePowerShell,
    resolveDefaults,
    syncProcessCwd,
    useBash,
    usePowerShell,
    usePwsh,
    which,
  ];

  // The goods and bundled helpers stay in `command-stream/zx`.
  // @ts-expect-error - fs is not part of the core entry
  use(core.fs);
  // @ts-expect-error - echo is not part of the core entry
  use(core.echo);
  // @ts-expect-error - YAML is not part of the core entry
  use(core.YAML);

  use(out, bound, values);
}
