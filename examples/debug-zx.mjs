#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('Testing zx compatibility...');

try {
  // Test regular $ first
  console.log('\n1. Testing regular $:');
  const regular = $`echo "test regular"`;
  console.log('Regular type:', typeof regular);
  console.log('Regular has .on:', typeof regular.on);
  
  const regularResult = await regular;
  console.log('Regular result:', regularResult);
  console.log('Regular result keys:', Object.keys(regularResult));
  
  // Test $.zx
  console.log('\n2. Testing $.zx:');
  const zx = $.zx`echo "test zx"`;
  console.log('ZX type:', typeof zx);
  console.log('ZX instanceof Promise:', zx instanceof Promise);
  
  const zxResult = await zx;
  console.log('ZX result:', zxResult);
  console.log('ZX stdout:', JSON.stringify(zxResult.stdout));
  console.log('ZX exitCode:', zxResult.exitCode);
  
} catch (error) {
  console.error('Error:', error);
  console.error('Stack:', error.stack);
}