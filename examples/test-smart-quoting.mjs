#!/usr/bin/env node

// Test smart quoting behavior for interpolated strings
// We need to preserve user-provided quotes while still auto-quoting when necessary

import { $ } from '../src/$.mjs';

console.log('=== Smart Quoting Tests ===\n');

async function testSmartQuoting() {
  const claude = '/Users/konard/.claude/local/claude';

  console.log('1. Testing user-provided quotes preservation:');
  console.log('----------------------------------------------');

  // Case 1: User provides single quotes
  console.log('\nCase 1: User wraps in single quotes');
  const singleQuoted = `'${claude}'`;
  console.log('Input:', singleQuoted);
  const cmd1 = $({ mirror: false })`${singleQuoted} --version`;
  console.log('Generated:', cmd1.spec.command);
  console.log(
    'Expected: Should preserve single quotes without double-escaping'
  );

  // Case 2: User provides double quotes
  console.log('\nCase 2: User wraps in double quotes');
  const doubleQuoted = `"${claude}"`;
  console.log('Input:', doubleQuoted);
  const cmd2 = $({ mirror: false })`${doubleQuoted} --version`;
  console.log('Generated:', cmd2.spec.command);
  console.log(
    'Expected: Should preserve double quotes (wrapped in single quotes for shell)'
  );

  // Case 3: No quotes from user - auto-quote
  console.log('\nCase 3: No quotes from user');
  console.log('Input:', claude);
  const cmd3 = $({ mirror: false })`${claude} --version`;
  console.log('Generated:', cmd3.spec.command);
  console.log('Expected: Should auto-quote the path');

  console.log('\n2. Testing smart auto-quoting (only when needed):');
  console.log('--------------------------------------------------');

  // Test various strings that need/don't need escaping
  const testCases = [
    {
      desc: 'Simple command (no special chars)',
      value: 'echo',
      needsQuoting: false,
    },
    {
      desc: 'Path with spaces',
      value: '/path with spaces/command',
      needsQuoting: true,
    },
    {
      desc: 'Path with special chars',
      value: '/path/with$special&chars',
      needsQuoting: true,
    },
    {
      desc: 'Simple path (no special chars)',
      value: '/usr/bin/echo',
      needsQuoting: false, // Ideally shouldn't need quotes
    },
    {
      desc: 'String with single quote',
      value: "can't",
      needsQuoting: true,
    },
    {
      desc: 'Empty string',
      value: '',
      needsQuoting: true, // Empty needs quotes
    },
  ];

  for (const { desc, value, needsQuoting } of testCases) {
    console.log(`\n${desc}:`);
    console.log('Input:', JSON.stringify(value));
    const cmd = $({ mirror: false })`echo ${value}`;
    console.log('Generated:', cmd.spec.command);
    console.log('Needs quoting:', needsQuoting);
  }

  console.log('\n3. Testing complex scenarios:');
  console.log('------------------------------');

  // Scenario 1: Mixed quoted and unquoted
  console.log('\nScenario 1: Mixed arguments');
  const path = '/usr/bin/env';
  const arg1 = 'node';
  const arg2 = '--version';
  const mixedCmd = $({ mirror: false })`${path} ${arg1} ${arg2}`;
  console.log('Generated:', mixedCmd.spec.command);

  // Scenario 2: User pre-quotes some args
  console.log('\nScenario 2: Some args pre-quoted by user');
  const quotedArg = '"my file.txt"';
  const unquotedArg = 'output.log';
  const partialCmd = $({ mirror: false })`cat ${quotedArg} > ${unquotedArg}`;
  console.log('Generated:', partialCmd.spec.command);

  // Scenario 3: Command with already-escaped characters
  console.log('\nScenario 3: Already-escaped characters');
  const escaped = "can\\'t";
  const escapedCmd = $({ mirror: false })`echo ${escaped}`;
  console.log('Input (escaped):', escaped);
  console.log('Generated:', escapedCmd.spec.command);

  console.log('\n4. Testing actual execution with quotes:');
  console.log('-----------------------------------------');

  // Test that quotes work correctly in practice
  try {
    // Test with spaces in argument
    const result1 = await $`echo ${'hello world'}`;
    console.log('Spaces test output:', String(result1).trim());

    // Test with special characters
    const result2 = await $`echo ${'$HOME'}`;
    console.log('Special char test output:', String(result2).trim());
    console.log('(Should print literal $HOME, not expanded)');

    // Test with single quotes in content
    const result3 = await $`echo ${"it's working"}`;
    console.log('Single quote test output:', String(result3).trim());
  } catch (error) {
    console.error('Execution error:', error.message);
  }

  console.log('\n5. Edge cases for quote handling:');
  console.log('----------------------------------');

  // Test various edge cases
  const edgeCases = [
    {
      desc: 'Just single quote',
      input: "'",
      expected: 'Should escape properly',
    },
    {
      desc: 'Just double quote',
      input: '"',
      expected: 'Should escape properly',
    },
    {
      desc: 'Empty single quotes',
      input: "''",
      expected: 'Should preserve as-is',
    },
    {
      desc: 'Empty double quotes',
      input: '""',
      expected: 'Should wrap in single quotes',
    },
    {
      desc: 'Nested quotes',
      input: '"\'nested\'"',
      expected: 'Should handle nested quotes',
    },
    {
      desc: 'Triple quotes',
      input: "'''",
      expected: 'Should escape all quotes',
    },
  ];

  for (const { desc, input, expected } of edgeCases) {
    console.log(`\n${desc}:`);
    console.log('Input:', JSON.stringify(input));
    const cmd = $({ mirror: false })`echo ${input}`;
    console.log('Generated:', cmd.spec.command);
    console.log('Expected:', expected);
  }
}

testSmartQuoting().catch(console.error);
