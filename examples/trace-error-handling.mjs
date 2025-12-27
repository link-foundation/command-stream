#!/usr/bin/env node

/**
 * Error Handling Tracing Test
 *
 * Tests error conditions with tracing to debug error propagation,
 * cleanup on failure, and exception handling.
 *
 * Usage:
 *   COMMAND_STREAM_TRACE=ProcessRunner node examples/trace-error-handling.mjs
 */

import { $ } from '../src/$.mjs';

console.log('Testing error handling with tracing...');

try {
  const result = await $`/nonexistent/command`;
  console.log('✗ Should have failed');
} catch (error) {
  console.log('✓ Error caught (expected):', error.message);
}
