#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function simpleWorkingStdin() {
  console.log('Simple working stdin test');

  // Example 1: Basic approach with manual timing
  const cmd = $`cat`;

  // Trigger start
  cmd.streams.stdout;

  // Wait for process to spawn
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Now get stdin
  const stdin = cmd.streams.stdin;
  console.log('Stdin available?', !!stdin);

  if (stdin) {
    stdin.write('Hello!\\n');
    stdin.end();
  }

  const result = await cmd;
  console.log('Result:', result.stdout);
}

simpleWorkingStdin().catch(console.error);
