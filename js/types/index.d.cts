/**
 * TypeScript declarations for command-stream (CommonJS entry point).
 *
 * `require('command-stream')` returns the `$` tagged template with every
 * named export attached, plus `$.$` and `$.default` pointing back to it.
 */

import type * as CommandStream from './api.cjs';

type Exports = Omit<typeof CommandStream, 'default' | '$' | 'spawn'>;

interface CommonJsDollar extends CommandStream.Dollar, Exports {
  $: CommonJsDollar;
  default: CommonJsDollar;
}

declare const $: CommonJsDollar;

declare namespace $ {
  export type ProcessRunner = CommandStream.ProcessRunner;
  export type StreamEmitter<
    Events extends { [K in keyof Events]: unknown[] } =
      CommandStream.ProcessRunnerEvents,
  > = CommandStream.StreamEmitter<Events>;
  export type AnsiConfig = CommandStream.AnsiConfig;
  export type AnsiUtilities = CommandStream.AnsiUtilities;
  export type CapturedReadable = CommandStream.CapturedReadable;
  export type CapturedWritable = CommandStream.CapturedWritable;
  export type ChildReadableStream = CommandStream.ChildReadableStream;
  export type ChildWritableStream = CommandStream.ChildWritableStream;
  export type CommandError = CommandStream.CommandError;
  export type CommandResult = CommandStream.CommandResult;
  export type CommandSpec = CommandStream.CommandSpec;
  export type CommandTag = CommandStream.CommandTag;
  export type CrossSpawn = CommandStream.CrossSpawn;
  export type Dollar = CommandStream.Dollar;
  export type ExitChunk = CommandStream.ExitChunk;
  export type KillSignal = CommandStream.KillSignal;
  export type LiteralValue = CommandStream.LiteralValue;
  export type MaybePromise<T> = CommandStream.MaybePromise<T>;
  export type OutputChunk<T extends OutputStreamName = OutputStreamName> =
    CommandStream.OutputChunk<T>;
  export type OutputStreamName = CommandStream.OutputStreamName;
  export type ParsedAsciicast = CommandStream.ParsedAsciicast;
  export type PendingChildHandle = CommandStream.PendingChildHandle;
  export type PipeDestination = CommandStream.PipeDestination;
  export type ProcessChild = CommandStream.ProcessChild;
  export type ProcessOptions = CommandStream.ProcessOptions;
  export type ProcessRunnerEventName = CommandStream.ProcessRunnerEventName;
  export type ProcessRunnerEvents = CommandStream.ProcessRunnerEvents;
  export type ProcessRunnerListener<K extends ProcessRunnerEventName> =
    CommandStream.ProcessRunnerListener<K>;
  export type QuoteContext = CommandStream.QuoteContext;
  export type RawValue = CommandStream.RawValue;
  export type ResultBase = CommandStream.ResultBase;
  export type RuntimeSubprocess = CommandStream.RuntimeSubprocess;
  export type Shell = CommandStream.Shell;
  export type ShellOption = CommandStream.ShellOption;
  export type ShellSettings = CommandStream.ShellSettings;
  export type StartOptions = CommandStream.StartOptions;
  export type StdinMode = CommandStream.StdinMode;
  export type StdinOption = CommandStream.StdinOption;
  export type StdioViews<In, Out = In> = CommandStream.StdioViews<In, Out>;
  export type StreamChunk = CommandStream.StreamChunk;
  export type StreamResult = CommandStream.StreamResult;
  export type SyncStartOptions = CommandStream.SyncStartOptions;
  export type TemplateValue = CommandStream.TemplateValue;
  export type TerminalArtifactOptions = CommandStream.TerminalArtifactOptions;
  export type TerminalAsciicast = CommandStream.TerminalAsciicast;
  export type TerminalCaptureError = CommandStream.TerminalCaptureError;
  export type TerminalCaptureResult = CommandStream.TerminalCaptureResult;
  export type TerminalCell = CommandStream.TerminalCell;
  export type TerminalCloseOptions = CommandStream.TerminalCloseOptions;
  export type TerminalDisposable = CommandStream.TerminalDisposable;
  export type TerminalExitStatus = CommandStream.TerminalExitStatus;
  export type TerminalFrame = CommandStream.TerminalFrame;
  export type TerminalInteraction = CommandStream.TerminalInteraction;
  export type TerminalKeyName = CommandStream.TerminalKeyName;
  export type TerminalOptions = CommandStream.TerminalOptions;
  export type TerminalProcess = CommandStream.TerminalProcess;
  export type TerminalSession = CommandStream.TerminalSession;
  export type TerminalSize = CommandStream.TerminalSize;
  export type TerminalTraceEvent = CommandStream.TerminalTraceEvent;
  export type TerminalWaitOptions = CommandStream.TerminalWaitOptions;
  export type VirtualCommandChunk = CommandStream.VirtualCommandChunk;
  export type VirtualCommandContext = CommandStream.VirtualCommandContext;
  export type VirtualCommandFunction = CommandStream.VirtualCommandFunction;
  export type VirtualCommandGenerator = CommandStream.VirtualCommandGenerator;
  export type VirtualCommandHandler = CommandStream.VirtualCommandHandler;
  export type VirtualCommandResult = CommandStream.VirtualCommandResult;
}

export = $;
