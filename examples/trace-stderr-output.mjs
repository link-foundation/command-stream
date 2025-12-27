#!/usr/bin/env node

/**
 * Stderr Output Tracing Test
 *
 * Tests stdout/stderr handling with tracing to debug stream pumping,
 * data capture, and I/O operations.
 *
 * Usage:
 *   COMMAND_STREAM_TRACE=ProcessRunner node examples/trace-stderr-output.mjs
 */

import { $ } from '../src/$.mjs';

console.log('Testing stderr output with tracing...');

const result =
  await $`sh -c 'echo "stdout message" && echo "stderr message" >&2'`;

console.log('✓ Command result:', result.code);
console.log('  stdout:', JSON.stringify(result.stdout.trim()));
console.log('  stderr:', JSON.stringify(result.stderr.trim()));
