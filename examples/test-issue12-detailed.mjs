#!/usr/bin/env node

// Detailed test for issue #12 - checking error messages and command construction
// Original issue: https://github.com/link-foundation/command-stream/issues/12
// Original error: ENOENT: no such file or directory, posix_spawn ''/Users/konard/.claude/local/claude''

import { $ } from '../js/src/$.mjs';

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Detailed Issue #12 Testing ===\n');
console.log('Testing path:', claude);

async function testScenarios() {
  console.log('\n1. Test direct command (no pipe):');
  console.log('-----------------------------------');
  try {
    const cmd = $({ capture: true, mirror: false })`${claude} --version`;
    console.log('Generated command:', cmd.spec.command);
    const result = await cmd;
    console.log('Exit code:', result.code);
    console.log('Stderr:', result.stderr.trim());

    // Check for double quotes in stderr
    if (result.stderr.includes("''")) {
      console.log('❌ Double quotes found in stderr!');
    } else {
      console.log('✅ No double quotes in error');
    }
  } catch (error) {
    console.log('Exception:', error.message);
  }

  console.log('\n2. Test with pipe (original issue):');
  console.log('------------------------------------');
  try {
    const cmd = $({
      capture: true,
      mirror: false,
    })`${claude} -p "hi" --output-format stream-json --model sonnet | jq .`;
    console.log('Generated command:', cmd.spec.command);
    const result = await cmd;
    console.log('Exit code:', result.code);
    console.log('Output:', result.stdout || '(empty)');
  } catch (error) {
    console.log('Exception:', error.message);
  }

  console.log('\n3. Test command construction:');
  console.log('------------------------------');

  // Check different interpolation positions
  const testCases = [
    {
      desc: 'First position',
      template: (p) => $({ mirror: false })`${p} --test`,
    },
    {
      desc: 'Middle position',
      template: (p) => $({ mirror: false })`echo ${p} test`,
    },
    { desc: 'With pipe', template: (p) => $({ mirror: false })`${p} | cat` },
  ];

  for (const { desc, template } of testCases) {
    const cmd = template(claude);
    console.log(`${desc}: ${cmd.spec.command}`);
  }

  console.log('\n4. Check if pre-quoted paths work:');
  console.log('-----------------------------------');

  // Test if already-quoted paths are handled correctly
  const quotedPath = `'${claude}'`;
  console.log('Input (pre-quoted):', quotedPath);
  const quotedCmd = $({ mirror: false })`${quotedPath} --test`;
  console.log('Generated command:', quotedCmd.spec.command);

  if (
    quotedCmd.spec.command.includes("'''") ||
    quotedCmd.spec.command.includes("''")
  ) {
    console.log('⚠️  Potential issue with pre-quoted path handling');
  } else {
    console.log('✅ Pre-quoted path handled correctly');
  }
}

testScenarios().catch(console.error);
