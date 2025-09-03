import { $ } from '../src/$.mjs';

async function testInterpolation() {
  const name = 'World';
  const $custom = $({ capture: true, mirror: false });
  const result = await $custom`echo Hello, ${name}!`;
  
  console.log('Expected:', "Hello, 'World'!");
  console.log('Actual:  ', result.stdout.trim());
  console.log('Match:', result.stdout.trim() === "Hello, 'World'!");
  console.log('Code:', result.code);
}

testInterpolation().catch(console.error);