#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';
import { appendFileSync } from 'fs';

console.log('🤖 Command-stream: Claude → jq pipeline');

let chunkCount = 0;
const logFile = 'claude-jq-output.log';

const command = $({
  stdin: 'hi\n',
})`claude --output-format stream-json --verbose --model sonnet | jq -r '.type'`;

command
  .on('data', (chunk) => {
    chunkCount++;
    const data = chunk.data.toString();
    console.log(`📦 CHUNK ${chunkCount}: ${data.trim()}`);

    // Write to file simultaneously
    appendFileSync(logFile, `Chunk ${chunkCount}: ${data}`);
  })
  .on('end', (result) => {
    console.log(
      `✅ Got ${chunkCount} chunks, saved to ${logFile}, exit: ${result.code}`
    );
  })
  .start();
