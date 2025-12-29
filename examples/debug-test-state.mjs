// Debug test to understand why virtual commands get bypassed in full test suite
import { $ } from '../js/src/$.mjs';

async function debugTestState() {
  console.log('=== Debug Test State ===');

  // Test 1: Simple echo
  console.log('\nTest 1: Simple echo');
  const result1 = await $`echo simple`;
  console.log('Result1:', JSON.stringify(result1.stdout.trim()));

  // Test 2: Echo with interpolation (like the failing test)
  console.log('\nTest 2: Echo with interpolation');
  const name = 'World';
  const $custom = $({ capture: true, mirror: false });
  const result2 = await $custom`echo Hello, ${name}!`;
  console.log('Result2:', JSON.stringify(result2.stdout.trim()));
  console.log('Expected:', JSON.stringify("Hello, 'World'!"));
  console.log('Test passes:', result2.stdout.trim() === "Hello, 'World'!");

  // Test 3: Another echo to see if state persists
  console.log('\nTest 3: Another echo');
  const result3 = await $`echo test`;
  console.log('Result3:', JSON.stringify(result3.stdout.trim()));
}

debugTestState().catch(console.error);
