#!/usr/bin/env node

/**
 * Simple Command Tracing Test
 *
 * Tests basic command execution with tracing to debug process creation,
 * stdout/stderr handling, and completion.
 *
 * Usage:
 *   COMMAND_STREAM_TRACE=ProcessRunner node examples/trace-simple-command.mjs
 */

import { $ } from '../js/src/$.mjs';

console.log('Testing simple command execution with tracing...');

const result = await $`echo "Hello tracing"`;
console.log('✓ Result:', result.code, JSON.stringify(result.stdout.trim()));
