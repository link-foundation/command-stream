/**
 * Compile-only tests for `command-stream/process-runner`.
 */

import { ProcessRunner as RootProcessRunner } from 'command-stream';
import {
  ProcessRunner,
  type ProcessOptions,
  type StreamResult,
} from 'command-stream/process-runner';
import { expectType, type Equal } from './helpers.cjs';

export async function subpath(): Promise<void> {
  expectType<Equal<typeof ProcessRunner, typeof RootProcessRunner>>();
  const options: ProcessOptions = { mirror: false };
  const runner = new ProcessRunner({ mode: 'shell', command: 'true' }, options);
  const result = await runner;
  expectType<Equal<typeof result, StreamResult>>();
  expectType<Equal<typeof result.signal, NodeJS.Signals | null>>();
}
