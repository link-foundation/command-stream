#!/usr/bin/env node

// Summary comparison of all capture/mirror combinations

import { $ } from '../src/$.mjs';

console.log('📊 Capture/Mirror Combinations Summary:');
console.log('┌─────────┬────────┬─────────────┬──────────────┐');
console.log('│ capture │ mirror │ Console out │ result.stdout│');
console.log('├─────────┼────────┼─────────────┼──────────────┤');
console.log('│ true    │ true   │ YES         │ string       │');
console.log('│ true    │ false  │ NO          │ string       │');
console.log('│ false   │ true   │ YES         │ undefined    │');
console.log('│ false   │ false  │ NO          │ undefined    │');
console.log('└─────────┴────────┴─────────────┴──────────────┘');

console.log('\n💡 Use cases:');
console.log('  - capture: false, mirror: false → Maximum performance');
console.log('  - capture: true, mirror: false  → Silent data processing');
console.log('  - capture: false, mirror: true  → Just run and show output');
console.log(
  '  - capture: true, mirror: true   → Default (both capture and show)'
);
