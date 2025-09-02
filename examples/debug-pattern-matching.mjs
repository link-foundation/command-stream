#!/usr/bin/env bun
// Debug script to test pattern matching in signal handler detection

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

function testPatternMatching() {
  console.log('=== Pattern Matching Debug ===');
  
  console.log('\n1. Initial state:');
  const initialListeners = process.listeners('SIGINT');
  console.log('Initial listeners:', initialListeners.length);
  
  console.log('\n2. Creating a runner to install handler...');
  const runner = $`sleep 0.01`;
  const afterCreation = process.listeners('SIGINT');
  console.log('After creation:', afterCreation.length);
  
  if (afterCreation.length > 0) {
    const handler = afterCreation[0];
    const handlerStr = handler.toString();
    
    console.log('\n3. Testing pattern matching on actual handler:');
    console.log('Handler length:', handlerStr.length);
    console.log('Contains activeProcessRunners:', handlerStr.includes('activeProcessRunners'));
    console.log('Contains ProcessRunner:', handlerStr.includes('ProcessRunner'));
    console.log('Contains activeChildren:', handlerStr.includes('activeChildren'));
    
    const matchesPattern = handlerStr.includes('activeProcessRunners') && 
                          handlerStr.includes('ProcessRunner') && 
                          handlerStr.includes('activeChildren');
    console.log('Matches full pattern:', matchesPattern);
    
    console.log('\n4. Handler excerpt (first 200 chars):');
    console.log(handlerStr.substring(0, 200) + '...');
  }
  
  console.log('\n5. Testing manual cleanup simulation:');
  // Simulate what tests do - manually remove the listener
  const listenersToRemove = process.listeners('SIGINT');
  listenersToRemove.forEach(l => {
    process.removeListener('SIGINT', l);
  });
  
  console.log('After manual removal:', process.listeners('SIGINT').length);
  
  console.log('\n6. Creating another runner - should detect and reset:');
  const runner2 = $`sleep 0.01`;
  const afterSecondCreation = process.listeners('SIGINT');
  console.log('After second creation:', afterSecondCreation.length);
  
  // Clean up
  runner.kill();
  runner2.kill();
}

testPatternMatching();