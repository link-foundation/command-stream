#!/usr/bin/env node

// Test quoting edge cases for issue #12
import { $ } from '../js/src/$.mjs';

console.log('=== Testing Quote Edge Cases for Issue #12 ===\n');

async function testCommands() {
  // Test 1: Path as command (should NOT be quoted)
  console.log('1. Testing path as command:');
  const path = '/bin/echo';
  try {
    const result = await $`${path} "hello from echo"`;
    console.log('✓ Success:', String(result).trim());
  } catch (error) {
    console.error('✗ Failed:', error.message);
  }

  // Test 2: Path with spaces (needs special handling)
  console.log('\n2. Testing path with spaces:');
  const spacePath = '/path with spaces/bin/echo';
  try {
    // This should fail since the path doesn't exist, but check the error message
    const result = await $`${spacePath} "test"`;
    console.log('Result:', String(result).trim());
  } catch (error) {
    console.error('Expected failure:', error.message);
    // Check if quotes are doubled in the error
    if (error.message.includes("''")) {
      console.log('⚠️  Double quotes detected in error!');
    }
  }

  // Test 3: Command with arguments
  console.log('\n3. Testing command with multiple interpolations:');
  const cmd = 'echo';
  const arg1 = 'hello';
  const arg2 = 'world';
  try {
    const result = await $`${cmd} ${arg1} ${arg2}`;
    console.log('✓ Success:', String(result).trim());
  } catch (error) {
    console.error('✗ Failed:', error.message);
  }

  // Test 4: First interpolation is command, should not be quoted
  console.log('\n4. Testing first interpolation as command:');
  const ls = 'ls';
  try {
    const result = await $`${ls} -la`.pipe($`head -n 3`);
    console.log('✓ Success, got listing');
  } catch (error) {
    console.error('✗ Failed:', error.message);
  }

  // Test 5: Complex command construction
  console.log('\n5. Testing complex command:');
  const executable = '/usr/bin/env';
  const program = 'node';
  const flag = '--version';
  try {
    const result = await $`${executable} ${program} ${flag}`;
    console.log('✓ Success:', String(result).trim());
  } catch (error) {
    console.error('✗ Failed:', error.message);
  }
}

testCommands().catch(console.error);
