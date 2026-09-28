#!/usr/bin/env node

import { $ } from '../src/$.mjs';
import { appendFileSync } from 'fs';

console.log('🤖 Claude streaming example');

// Simple prompt that should stream
let events = 0;
const logFile = 'claude-stream.log';

for await (const chunk of $`claude hi`.stream()) {
  const data = chunk.data.toString();
  console.log(`📦 Event ${++events}: ${data.trim()}`);

  // Write to file simultaneously
  appendFileSync(logFile, `Event ${events}: ${data}`);
}

console.log(`✅ Received ${events} streaming events, logged to ${logFile}`);
