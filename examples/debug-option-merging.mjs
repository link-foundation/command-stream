#!/usr/bin/env node

// Testing option merging

import { $ } from '../src/$.mjs';

console.log('Testing option merging:');
const runner = $`echo "option merge test"`;

console.log('Initial options:', runner.options);
const result = await runner.start({ 
  capture: false, 
  mirror: false, 
  customOption: 'test' 
});
console.log('Final options:', runner.options);
console.log('Result:', { stdout: result.stdout, code: result.code });