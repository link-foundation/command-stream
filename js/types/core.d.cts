import type * as Core from './core-api.cjs';

type Exports = Omit<typeof Core, '$' | 'spawn'>;
interface CommonJsDollar extends Core.Dollar, Exports {
  $: CommonJsDollar;
  default: CommonJsDollar;
}
declare const $: CommonJsDollar;
declare namespace $ {
  export type Dollar = Core.Dollar;
  export type ProcessRunner = Core.ProcessRunner;
  export type ProcessOptions = Core.ProcessOptions;
  export type StreamResult = Core.StreamResult;
  export type VirtualCommandHandler = Core.VirtualCommandHandler;
  export type CommandResult = Core.CommandResult;
  export type CommandSpec = Core.CommandSpec;
  export type CommandTag = Core.CommandTag;
  export type ProcessRunnerEvents = Core.ProcessRunnerEvents;
  export type StartOptions = Core.StartOptions;
  export type StreamChunk = Core.StreamChunk;
  export type TemplateValue = Core.TemplateValue;
  export type VirtualCommandContext = Core.VirtualCommandContext;
  export type CommandHandler = Core.CommandHandler;
  export type CommandPackage = Core.CommandPackage;
  export type StreamOptions = Core.StreamOptions;
  export type StreamStats = Core.StreamStats;
  export type CommandBuilder<T = Core.StreamResult> = Core.CommandBuilder<T>;
  export type StreamPipeline<T> = Core.StreamPipeline<T>;
}
export = $;
