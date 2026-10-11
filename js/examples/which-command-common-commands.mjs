#!/usr/bin/env node

// Testing with other common commands

import { $ } from '../src/$.mjs';

console.log('Testing with other common commands:');
const commands = ['sh', 'ls', 'cat', 'grep'];

for (const cmd of commands) {
  try {
    const result = await $`which ${cmd}`;
    console.log(
      `which ${cmd}: exit code ${result.code}, path: ${result.stdout.trim()}`
    );
  } catch (error) {
    console.log(`which ${cmd}: ERROR: ${error.message}`);
  }
}
