#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== End Event Debug ===');

console.log('1. Testing await pattern with events:');
const cmd1 = $`echo "test1"`;
let endEventFired = false;

cmd1.on('end', (result) => {
  endEventFired = true;
  console.log('END event fired for await pattern');
});

const result1 = await cmd1;
console.log('Await completed. End event fired?', endEventFired);

console.log('2. Testing stream pattern with events:');
const cmd2 = $`echo "test2"`;
let streamEndEventFired = false;
let streamChunks = [];

cmd2.on('end', (result) => {
  streamEndEventFired = true;
  console.log('END event fired for stream pattern');
});

console.log('Starting stream iteration...');
try {
  // Set a timeout to break out of infinite loop
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Stream timeout')), 2000);
  });
  
  const streamPromise = (async () => {
    for await (const chunk of cmd2.stream()) {
      streamChunks.push(chunk);
      console.log('Stream chunk received:', chunk.type);
      
      // Check if end event fired after receiving chunks
      console.log('End event fired yet?', streamEndEventFired);
    }
  })();
  
  await Promise.race([streamPromise, timeoutPromise]);
  console.log('Stream completed normally');
} catch (error) {
  console.log('Stream timed out:', error.message);
}

console.log('Final state:');
console.log('- Stream chunks received:', streamChunks.length);
console.log('- End event fired?', streamEndEventFired);

console.log('Debug completed!');