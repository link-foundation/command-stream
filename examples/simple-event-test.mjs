#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('🧪 Simple event test');

// First test with a command we know works
$`echo "test"`
  .on('data', (chunk) => console.log('Echo chunk:', chunk.data.toString().trim()))
  .on('end', (result) => {
    console.log(`Echo done: ${result.code}`);
    
    // Now test Claude
    console.log('\n🤖 Testing Claude...');
    const claude = 'claude';
    
    $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`
      .on('data', (chunk) => {
        console.log('Claude chunk:', chunk.data.toString());
      })
      .on('end', (result) => {
        console.log('Claude done:', result.code);
        process.exit(0);
      })
      .on('error', (error) => {
        console.log('Claude error:', error);
        process.exit(1);
      })
      .start();
  })
  .start();