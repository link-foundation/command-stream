#!/usr/bin/env node

// Test shell injection protection with the smart quoting
import { $ } from '../src/$.mjs';

console.log('=== Shell Injection Protection Test ===\n');

async function testInjection() {
  // Test 1: Command chaining attempt
  console.log('1. Command chaining attempt:');
  const evil1 = 'test; echo INJECTED';
  const cmd1 = $({ mirror: false })`echo ${evil1}`;
  console.log('Input:', evil1);
  console.log('Command:', cmd1.spec.command);
  const result1 = await cmd1;
  const output1 = result1.stdout || String(result1);
  console.log('Output:', output1.trim());
  console.log(output1.includes('INJECTED') ? '❌ INJECTION!' : '✅ Protected');

  // Test 2: Variable expansion attempt
  console.log('\n2. Variable expansion attempt:');
  const evil2 = '$HOME';
  const cmd2 = $({ mirror: false })`echo ${evil2}`;
  console.log('Input:', evil2);
  console.log('Command:', cmd2.spec.command);
  const result2 = await cmd2;
  const output2 = (result2.stdout || String(result2)).trim();
  console.log('Output:', output2);
  console.log(
    output2 === '$HOME'
      ? '✅ Protected (literal $HOME)'
      : '❌ Variable expanded!'
  );

  // Test 3: Command substitution attempt
  console.log('\n3. Command substitution attempt:');
  const evil3 = '$(whoami)';
  const cmd3 = $({ mirror: false })`echo ${evil3}`;
  console.log('Input:', evil3);
  console.log('Command:', cmd3.spec.command);
  const result3 = await cmd3;
  const output3 = (result3.stdout || String(result3)).trim();
  console.log('Output:', output3);
  console.log(
    output3 === '$(whoami)'
      ? '✅ Protected (literal $(whoami))'
      : '❌ Command executed!'
  );

  // Test 4: Safe string - no unnecessary quotes
  console.log('\n4. Safe string (no unnecessary quotes):');
  const safe = 'hello';
  const cmd4 = $({ mirror: false })`echo ${safe}`;
  console.log('Input:', safe);
  console.log('Command:', cmd4.spec.command);
  const result4 = await cmd4;
  console.log('Output:', (result4.stdout || String(result4)).trim());
  console.log(
    !cmd4.spec.command.includes("'hello'")
      ? '✅ No unnecessary quotes'
      : '⚠️  Quoted when not needed'
  );

  // Test 5: Path without spaces - no unnecessary quotes
  console.log('\n5. Safe path (no unnecessary quotes):');
  const safePath = '/usr/bin/echo';
  const cmd5 = $({ mirror: false })`${safePath} test`;
  console.log('Input:', safePath);
  console.log('Command:', cmd5.spec.command);
  console.log(
    !cmd5.spec.command.startsWith("'")
      ? '✅ Path not unnecessarily quoted'
      : '⚠️  Path quoted when not needed'
  );
}

testInjection().catch(console.error);
