/** The lightweight shell API, shared by the ESM and CommonJS declarations. */
import type * as Api from './api.cjs';

export {
  ProcessRunner,
  sh,
  exec,
  spawnDetached,
  spawn,
  run,
  quote,
  quoteForContext,
  quoteLiteral,
  isQuoteContextEnabled,
  setQuoteContextEnabled,
  isPreQuotedPassthroughEnabled,
  setPreQuotedPassthroughEnabled,
  create,
  raw,
  literal,
  shell,
  set,
  resetGlobalState,
  unset,
  register,
  unregister,
  listCommands,
  enableVirtualCommands,
  disableVirtualCommands,
  AnsiUtils,
  configureAnsi,
  getAnsiConfig,
  processOutput,
  forceCleanupAll,
  command,
  CommandBuilder,
  fy,
  stream,
  merge,
  StreamPipeline,
  extend,
  inherit,
  compose,
} from './api.cjs';

export type {
  CommandResult,
  CommandSpec,
  CommandTag,
  ProcessOptions,
  ProcessRunnerEvents,
  StartOptions,
  StreamChunk,
  StreamResult,
  TemplateValue,
  VirtualCommandContext,
  VirtualCommandHandler,
  CommandHandler,
  CommandPackage,
  StreamOptions,
  StreamStats,
} from './api.cjs';

export interface Dollar
  extends
    Api.CommandTag,
    Pick<
      Api.Dollar,
      | 'command'
      | 'fy'
      | 'stream'
      | 'merge'
      | 'create'
      | 'register'
      | 'unregister'
      | 'listCommands'
      | 'extend'
      | 'inherit'
      | 'compose'
      | 'spawn'
    > {
  (options: Api.ProcessOptions): Api.CommandTag;
}

export declare const $: Dollar;
