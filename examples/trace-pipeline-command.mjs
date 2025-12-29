#!/usr/bin/env node

/**
 * Pipeline Command Tracing Test
 *
 * Tests pipeline command execution with tracing to debug command
 * parsing, pipeline creation, and multi-process coordination.
 *
 * Usage:
 *   COMMAND_STREAM_TRACE=ProcessRunner node examples/trace-pipeline-command.mjs
 */

import { $ } from '../js/src/$.mjs';

console.log('Testing pipeline command with tracing...');

const result = await $`echo "test data" | grep "test"`;
console.log(
  '✓ Pipeline result:',
  result.code,
  JSON.stringify(result.stdout.trim())
);
