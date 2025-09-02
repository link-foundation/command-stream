#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('Testing kill() method');

try {
  const runner = $`sleep 5`;
  console.log('Created runner');
  
  // Give it time to start
  setTimeout(async () => {
    console.log('Killing the command');
    try {
      runner.kill('SIGINT');
      console.log('Kill method called successfully');
    } catch (error) {
      console.error('Error in kill():', error.message);
      console.error('Error stack:', error.stack);
    }
  }, 500);
  
  console.log('Awaiting runner');
  const result = await runner.catch(error => {
    console.log('Runner caught error:', error.message);
    return { code: error.code || 130 };
  });
  
  console.log('Final result:', result);
  
} catch (error) {
  console.error('Outer error:', error.message);
  console.error('Stack:', error.stack);
}