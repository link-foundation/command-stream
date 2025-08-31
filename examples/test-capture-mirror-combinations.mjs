#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function testCombinations() {
  console.log('=== Testing all capture/mirror option combinations ===');
  
  const testCommand = 'echo "Option combination test"';
  
  console.log('\n1. Default behavior (capture: true, mirror: true):');
  console.log(`await $\`${testCommand}\``);
  const default1 = await $`echo "Default: both enabled"`;
  console.log(`  Console output: YES (you saw it above)`);
  console.log(`  Captured: ${JSON.stringify(default1.stdout)}`);
  
  console.log('\n2. capture: true, mirror: false:');
  console.log(`await $\`${testCommand}\`.start({ capture: true, mirror: false })`);
  const combo1 = await $`echo "Captured but silent"`.start({ capture: true, mirror: false });
  console.log(`  Console output: NO (you didn't see it)`);
  console.log(`  Captured: ${JSON.stringify(combo1.stdout)}`);
  
  console.log('\n3. capture: false, mirror: true:');
  console.log(`await $\`${testCommand}\`.start({ capture: false, mirror: true })`);
  const combo2 = await $`echo "Shown but not captured"`.start({ capture: false, mirror: true });
  console.log(`  Console output: YES (you saw it above)`);
  console.log(`  Captured: ${JSON.stringify(combo2.stdout)}`);
  
  console.log('\n4. capture: false, mirror: false:');
  console.log(`await $\`${testCommand}\`.start({ capture: false, mirror: false })`);
  const combo3 = await $`echo "Neither shown nor captured"`.start({ capture: false, mirror: false });
  console.log(`  Console output: NO (you didn't see it)`);
  console.log(`  Captured: ${JSON.stringify(combo3.stdout)}`);
  
  console.log('\n📊 Summary:');
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
  console.log('  - capture: true, mirror: true   → Default (both capture and show)');
}

testCombinations().catch(console.error);