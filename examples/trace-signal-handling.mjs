#!/usr/bin/env node

/**
 * Signal Handling Tracing Test
 *
 * Tests process killing and signal handling with tracing to debug
 * SIGINT forwarding and cleanup operations.
 *
 * Usage:
 *   COMMAND_STREAM_TRACE=ProcessRunner node examples/trace-signal-handling.mjs
 */

import { $ } from '../src/$.mjs';

console.log('Testing signal handling with tracing...');

const runner = $`sleep 3`;
const promise = runner.start();

setTimeout(() => {
  console.log('🔪 Killing process with SIGINT...');
  runner.kill('SIGINT');
}, 500);

try {
  const result = await promise;
  console.log('✓ Sleep result (killed):', result.code);
} catch (error) {
  console.log(
    '✓ Sleep was interrupted (expected):',
    error.message,
    'code:',
    error.code
  );
}
