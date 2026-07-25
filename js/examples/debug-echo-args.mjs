import { $ } from '../src/$.mjs';

async function debugEchoArgs() {
  console.log('=== Debug Echo Args ===');

  // Test the exact same interpolation as the failing test
  const name = 'World';
  const $custom = $({ capture: true, mirror: false });

  console.log('About to run: echo Hello, ${name}!');
  console.log('Where name =', JSON.stringify(name));
  console.log("This should build command: echo Hello, 'World'!");

  const result = await $custom`echo Hello, ${name}!`;

  console.log('Result stdout:', JSON.stringify(result.stdout));
  console.log('Result stdout trimmed:', JSON.stringify(result.stdout.trim()));
  console.log('Expected by test:', JSON.stringify('Hello, World!'));
  console.log('Test passes:', result.stdout.trim() === 'Hello, World!');
}

debugEchoArgs().catch(console.error);
