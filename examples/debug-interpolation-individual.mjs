// Test the specific interpolation case to see how it behaves in isolation
import { $ } from '../src/$.mjs';

async function testIndividualInterpolation() {
  console.log('Testing interpolation individually...');
  
  const name = 'World';
  const $custom = $({ capture: true, mirror: false });
  const result = await $custom`echo Hello, ${name}!`;
  
  console.log('Command that should have been built: echo Hello, \'World\'!');
  console.log('Actual result.stdout:', JSON.stringify(result.stdout));
  console.log('Trimmed result:', JSON.stringify(result.stdout.trim()));
  console.log('Expected (test expectation):', JSON.stringify("Hello, 'World'!"));
  console.log('Actual matches expected:', result.stdout.trim() === "Hello, 'World'!");
  console.log('What we actually get matches shell behavior:', result.stdout.trim() === "Hello, World!");
}

testIndividualInterpolation().catch(console.error);