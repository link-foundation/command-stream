#!/usr/bin/env node

import { $ } from '../src/$.mjs';
import { appendFileSync } from 'fs';

const claude = 'claude';
const logFile = 'claude-output.log';

console.log('🤖 Claude streaming to console and file');

let events = 0;
for await (const chunk of $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`.stream()) {
  const data = chunk.data.toString();
  console.log(`📦 Event ${++events}: ${data.trim()}`);
  
  // Write to file simultaneously  
  appendFileSync(logFile, `Event ${events}: ${data}`);
}

console.log(`✅ ${events} events streamed to console and saved to ${logFile}`);