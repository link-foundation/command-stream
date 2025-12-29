#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

const claude = 'claude';
console.log('🐛 Debug chunking test');

let events = 0;
let totalData = '';

const command = $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`;

command
  .on('data', (chunk) => {
    events++;
    const data = chunk.data.toString();
    console.log(`\n📦 Chunk ${events} (${data.length} bytes):`);
    console.log(`"${data}"`);
    totalData += data;
  })
  .on('end', (result) => {
    console.log(
      `\n✅ Done: ${events} chunks, ${totalData.length} total bytes, exit: ${result.code}`
    );
    process.exit(0);
  })
  .on('error', (error) => {
    console.log('❌ Error:', error);
    process.exit(1);
  });

// Timeout after 15 seconds
setTimeout(() => {
  console.log(`\n⏰ Timeout: ${events} chunks received so far`);
  process.exit(0);
}, 15000);

command.start();
