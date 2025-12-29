#!/usr/bin/env node

// Testing already started behavior

import { $ } from '../js/src/$.mjs';

console.log('Testing already started behavior:');
const runner = $`echo "already started"`;

// First start
const firstResult = await runner.start({ capture: true });
console.log('First start result:', JSON.stringify(firstResult.stdout));

// Try to start again with different options
const secondResult = await runner.start({ capture: false });
console.log(
  'Second start result (should ignore new options):',
  JSON.stringify(secondResult.stdout)
);
console.log('Same result reference?', firstResult === secondResult);
