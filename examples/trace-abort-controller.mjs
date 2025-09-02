#!/usr/bin/env node

/**
 * AbortController Tracing Test
 * 
 * Tests AbortController integration with tracing to debug external
 * signal handling and virtual command cancellation.
 * 
 * Usage:
 *   COMMAND_STREAM_TRACE=ProcessRunner node examples/trace-abort-controller.mjs
 */

import { $ } from '../src/$.mjs';

console.log('Testing AbortController with tracing...');

const controller = new AbortController();
const promise = $({ signal: controller.signal })`sleep 2`;

setTimeout(() => {
  console.log('🛑 Aborting with AbortController...');
  controller.abort();
}, 300);

try {
  const result = await promise;
  console.log('✓ Virtual sleep result:', result.code);
} catch (error) {
  console.log('✓ Virtual sleep was aborted (expected):', error.message);
}