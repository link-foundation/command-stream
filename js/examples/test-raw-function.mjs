#!/usr/bin/env node

// Example: Using raw() to disable auto-escape for trusted command strings
// This demonstrates the solution to issue #139

import { $, raw } from '../src/$.mjs';

console.log('=== raw() Function Examples ===\n');

async function demonstrateRaw() {
  console.log('1. Basic raw() usage with trusted commands:');
  console.log('----------------------------------------------');

  // Example 1: Simple command with shell operators
  console.log('\nExample 1: Command with && operator');
  const cmd1 = 'echo "Step 1" && echo "Step 2"';
  console.log('Input:', cmd1);
  const result1 = await $`${raw(cmd1)}`;
  console.log('Output:', result1.stdout.trim());
  console.log('Expected: Both steps executed\n');

  // Example 2: Command with pipes
  console.log('Example 2: Command with pipe operator');
  const cmd2 = 'echo "hello world" | wc -w';
  console.log('Input:', cmd2);
  const result2 = await $`${raw(cmd2)}`;
  console.log('Output:', result2.stdout.trim());
  console.log('Expected: Word count = 2\n');

  // Example 3: Complex command with multiple operators
  console.log('Example 3: Complex command with redirects and pipes');
  const cmd3 = 'seq 1 5 | head -n 3';
  console.log('Input:', cmd3);
  const result3 = await $`${raw(cmd3)}`;
  console.log('Output:', result3.stdout.trim());
  console.log('Expected: Numbers 1, 2, 3\n');

  console.log('2. Combining raw() with safe interpolation:');
  console.log('----------------------------------------------');

  // Example 4: Mix raw command with safe user input
  console.log('\nExample 4: Raw command + safe variable');
  const safeInput = 'test file.txt'; // This will be auto-quoted
  const cmd4 = raw('echo "Processing:"');
  const result4 = await $`${cmd4} ${safeInput}`;
  console.log('Command:', `${cmd4.raw} [auto-quoted: ${safeInput}]`);
  console.log('Output:', result4.stdout.trim());
  console.log('Note: File name was safely quoted\n');

  console.log('3. Configuration-based commands (safe use case):');
  console.log('--------------------------------------------------');

  // Example 5: Pre-defined commands from configuration
  const config = {
    listHidden: 'ls -la | grep "^\\."',
    countFiles: 'ls -1 | wc -l',
    diskUsage: 'du -sh . 2>/dev/null || echo "N/A"',
  };

  console.log('\nExample 5: Commands from trusted configuration');
  for (const [name, command] of Object.entries(config)) {
    console.log(`\n${name}:`, command);
    try {
      const result = await $({ mirror: false })`${raw(command)}`;
      console.log(
        'Output:',
        result.stdout.trim() || result.stderr.trim() || '(no output)'
      );
      console.log('Exit code:', result.code);
    } catch (error) {
      console.log('Error:', error.message);
    }
  }

  console.log('\n4. Comparison: raw() vs normal interpolation:');
  console.log('-----------------------------------------------');

  const testString = 'echo "test" && ls';

  console.log('\nWith raw() - executes as shell command:');
  console.log('Input:', testString);
  const rawResult = await $({ mirror: false })`${raw(testString)}`;
  console.log('Executed:', testString);
  console.log(
    'Output lines:',
    rawResult.stdout.split('\n').filter((l) => l.trim()).length
  );

  console.log('\nWithout raw() - treated as literal string:');
  console.log('Input:', testString);
  const normalResult = await $({ mirror: false })`echo ${testString}`;
  console.log('Executed: echo with quoted string');
  console.log('Output:', normalResult.stdout.trim());
  console.log('Note: Special characters were escaped\n');

  console.log('5. Security demonstration:');
  console.log('---------------------------');

  console.log('\n⚠️  WARNING: Never use raw() with untrusted input!');

  // Demonstrate the danger
  const dangerousInput = 'hello; rm -rf /tmp/test-*';

  console.log('\nDangerous string:', dangerousInput);
  console.log('\n❌ With raw() (DANGEROUS - would execute malicious code):');
  console.log('   Would execute:', dangerousInput);
  console.log('   Status: SKIPPED for safety\n');

  console.log('✅ Without raw() (SAFE - auto-escaped):');
  const safeResult = await $({ mirror: false })`echo ${dangerousInput}`;
  console.log('   Executed: echo with safely quoted string');
  console.log('   Output:', safeResult.stdout.trim());
  console.log('   Note: Malicious code was neutralized by auto-quoting\n');

  console.log('6. Practical use cases for raw():');
  console.log('-----------------------------------');

  console.log('\n✅ GOOD use case: Build scripts');
  const buildSteps = raw('npm run lint && npm run test && npm run build');
  console.log('Build command:', buildSteps.raw);
  console.log('Note: Trusted command from your codebase\n');

  console.log('✅ GOOD use case: Deployment commands');
  const deployCmd = raw('git pull && npm install && pm2 reload app');
  console.log('Deploy command:', deployCmd.raw);
  console.log('Note: Hardcoded deployment sequence\n');

  console.log('✅ GOOD use case: Complex shell pipelines');
  const analyzeCmd = raw('cat log.txt | grep ERROR | wc -l');
  console.log('Analysis command:', analyzeCmd.raw);
  console.log('Note: Pre-defined analysis pipeline\n');

  console.log('❌ BAD use case: User input');
  console.log('const userCmd = getUserInput();');
  console.log('await $`${raw(userCmd)}`; // ❌ DANGEROUS!');
  console.log(
    'Note: NEVER use raw() with user input - use normal interpolation\n'
  );

  console.log('Summary:');
  console.log('--------');
  console.log(
    '✅ Use raw() for: Trusted commands, config files, hardcoded strings'
  );
  console.log(
    '❌ Never use raw() for: User input, external data, untrusted sources'
  );
  console.log(
    '💡 Default behavior (auto-escape) is safe and should be used for all user input'
  );
}

demonstrateRaw().catch(console.error);
