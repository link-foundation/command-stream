/**
 * TypeScript declarations for `command-stream/zx/core` (CommonJS entry point,
 * re-exported by `zx-core.d.ts`).
 *
 * The core subset of the zx-compatible API: `$`, the process classes, option
 * helpers and the helpers the core itself depends on (`chalk`, `which`, `ps`,
 * `path`, `os`). The declarations live in `zx-api.d.cts`.
 */

export {
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
} from './zx-api.cjs';

export type {
  ChalkInstance,
  Duration,
  Log,
  LogEntry,
  LogFormatters,
  Options,
  PipeAcceptor,
  PipeMethod,
  ProcessDto,
  ProcessStage,
  PromisifiedStream,
  Ps,
  PsLookupEntry,
  Shell,
  SpawnStore,
  Which,
  WhichOptions,
} from './zx-api.cjs';
