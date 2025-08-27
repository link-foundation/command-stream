#!/usr/bin/env node

import { $ } from '../$.mjs';

async function testOptionsPassthrough() {
  console.log('Testing options passthrough with .start() and .run()...');
  
  // Test 1: Using .start() with capture: false
  console.log('\n1. Testing $`echo test`.start({ capture: false }):');
  const result1 = await $`echo "test with capture false"`.start({ capture: false });
  console.log('Result stdout:', JSON.stringify(result1.stdout)); // Should be undefined
  console.log('Result code:', result1.code);
  
  // Test 2: Using .start() with mirror: false (should still capture but not show output)
  console.log('\n2. Testing $`echo test`.start({ mirror: false }):');
  const result2 = await $`echo "test with mirror false"`.start({ mirror: false });
  console.log('Result stdout:', JSON.stringify(result2.stdout)); // Should have content
  console.log('Result code:', result2.code);
  
  // Test 3: Using .run() alias with capture: false
  console.log('\n3. Testing $`echo test`.run({ capture: false }):');
  const result3 = await $`echo "test with run alias"`.run({ capture: false });
  console.log('Result stdout:', JSON.stringify(result3.stdout)); // Should be undefined
  console.log('Result code:', result3.code);
  
  // Test 4: Using .run() alias with both mirror and capture options
  console.log('\n4. Testing $`echo test`.run({ mirror: false, capture: true }):');
  const result4 = await $`echo "test with both options"`.run({ mirror: false, capture: true });
  console.log('Result stdout:', JSON.stringify(result4.stdout)); // Should have content
  console.log('Result code:', result4.code);
  
  // Test 5: Compare with default behavior (direct await)
  console.log('\n5. Testing default await $`echo test` (for comparison):');
  const result5 = await $`echo "test default behavior"`;
  console.log('Result stdout:', JSON.stringify(result5.stdout)); // Should have content
  console.log('Result code:', result5.code);
  
  // Test 6: Verify that capture: false and mirror: false together works
  console.log('\n6. Testing $`echo test`.start({ capture: false, mirror: false }):');
  const result6 = await $`echo "no capture, no mirror"`.start({ capture: false, mirror: false });
  console.log('Result stdout:', JSON.stringify(result6.stdout)); // Should be undefined
  console.log('Result code:', result6.code);
  
  console.log('\nAll tests completed!');
}

testOptionsPassthrough().catch(console.error);