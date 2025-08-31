#!/usr/bin/env node

// Testing virtual vs real commands

import { $ } from '../src/$.mjs';

console.log('Testing virtual vs real commands:');

// Test with virtual echo command
console.log('\nVirtual command (echo):');
const runner1 = $`echo "virtual test"`;
console.log('Runner spec:', runner1.spec);
console.log('Runner spec mode:', runner1.spec.mode);

const result1 = await runner1.start({ capture: false });
console.log('Final result:', result1);

// Test with real shell command
console.log('\nReal shell command (ls):');
const runner2 = $`ls /tmp`;
console.log('Runner spec:', runner2.spec);
console.log('Runner spec mode:', runner2.spec.mode);

const result2 = await runner2.start({ capture: false });
console.log('Final result keys:', Object.keys(result2));
console.log('Result stdout type:', typeof result2.stdout);