#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('=== Test Event Emissions ===\n');

console.log('Test: emulate | cat | jq with event listeners');
const cmd = $`bun run examples/emulate-claude-stream.mjs | cat | jq .`;

const start = Date.now();
let eventCount = 0;

// Listen to raw stdout events
cmd.on('stdout', (data) => {
  eventCount++;
  const elapsed = Date.now() - start;
  const text = data.toString().trim();
  if (eventCount <= 3 || elapsed < 700) {
    console.log(`[${elapsed}ms] Event ${eventCount}: ${text.substring(0, 50)}...`);
  }
});

// Also run the command
const result = await cmd;

console.log(`\nTotal events: ${eventCount}`);
console.log(`Final output length: ${result.stdout.length} chars`);

if (eventCount >= 5) {
  console.log('✅ Real-time events are being emitted from source!');
  console.log('The implementation is streaming correctly.');
  console.log('The formatted jq output is available in result.stdout');
} else {
  console.log('❌ Not enough events emitted');
}