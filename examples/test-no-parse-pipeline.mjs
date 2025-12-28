#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('Testing: Disable pipeline parsing, let sh handle it\n');

// Temporarily disable pipeline parsing to test
const originalParse = $.prototype._parseCommand;
$.prototype._parseCommand = function (command) {
  // Skip pipeline parsing
  return null;
};

const start = Date.now();

// This will now be executed as a single sh command
const cmd = $`bun run examples/emulate-claude-stream.mjs | jq .`;

for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const lines = chunk.data
      .toString()
      .split('\n')
      .filter((l) => l.trim());
    for (const line of lines) {
      console.log(`[${elapsed}ms] ${line}`);
    }
  }
}

// Restore original parsing
$.prototype._parseCommand = originalParse;
