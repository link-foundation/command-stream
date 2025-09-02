#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Stream Internals Debug ===');

const cmd = $`sh -c 'echo "test"'`;

// Instrument the stream method to see internal state
const originalStream = cmd.stream.bind(cmd);
cmd.stream = function() {
  console.log('stream() called');
  
  const generator = originalStream();
  
  // Override the generator's next method to log state changes
  const originalNext = generator.next.bind(generator);
  generator.next = function() {
    console.log('generator.next() called');
    const promise = originalNext();
    
    promise.then(result => {
      console.log('generator.next() resolved:', {
        done: result.done,
        hasValue: !!result.value,
        valueType: result.value?.type
      });
    }).catch(err => {
      console.log('generator.next() error:', err.message);
    });
    
    return promise;
  };
  
  return generator;
};

console.log('Starting stream test...');

const timeout = setTimeout(() => {
  console.log('TIMEOUT: Stream test took too long');
  process.exit(1);
}, 3000);

try {
  let count = 0;
  for await (const chunk of cmd.stream()) {
    count++;
    console.log(`Received chunk ${count}:`, chunk.type);
    
    if (count >= 2) {
      console.log('Breaking after 2 chunks');
      break;
    }
  }
  
  clearTimeout(timeout);
  console.log('Stream test completed with', count, 'chunks');
} catch (error) {
  clearTimeout(timeout);
  console.log('Stream test error:', error.message);
}
