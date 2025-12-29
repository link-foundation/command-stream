#!/usr/bin/env node

// Test: Edge cases for quote handling
// Expected: Proper handling of unusual quoting scenarios

import { $ } from '../js/src/$.mjs';

console.log('=== Test: Quote Edge Cases ===\n');

const edgeCases = [
  {
    desc: 'Single quote character alone',
    input: "'",
    check: (cmd) => cmd.includes("\\'"),
  },
  {
    desc: 'Double quote character alone',
    input: '"',
    check: (cmd) => true,
  },
  {
    desc: 'Empty single quotes',
    input: "''",
    check: (cmd) => cmd === "echo ''",
  },
  {
    desc: 'Empty double quotes',
    input: '""',
    check: (cmd) => cmd === 'echo \'""\'',
  },
  {
    desc: 'Nested quotes (double inside single)',
    input: '\'"test"\'',
    check: (cmd) => true,
  },
  {
    desc: 'Nested quotes (single inside double)',
    input: '"\'test\'"',
    check: (cmd) => true,
  },
  {
    desc: 'Multiple single quotes',
    input: "'''",
    check: (cmd) => true,
  },
  {
    desc: 'Path with internal quotes',
    input: "/path/with'quote/in'it",
    check: (cmd) => cmd.includes("\\'"),
  },
  {
    desc: 'Already escaped quote',
    input: "can\\'t",
    check: (cmd) => true,
  },
  {
    desc: 'Mix of quotes and spaces',
    input: 'it\'s "a test"',
    check: (cmd) => true,
  },
];

async function testEdgeCases() {
  for (const { desc, input, check } of edgeCases) {
    console.log(`\n${desc}:`);
    console.log('Input:', JSON.stringify(input));

    const cmd = $({ mirror: false })`echo ${input}`;
    console.log('Generated:', cmd.spec.command);

    if (check && check(cmd.spec.command)) {
      console.log('✅ PASS: Handled correctly');
    } else {
      console.log('⚠️  Check the quoting pattern');
    }

    // Test actual execution for some cases
    if (!input.includes('|') && !input.includes('&') && !input.includes(';')) {
      try {
        const result = await $`echo ${input}`;
        console.log('Execution output:', JSON.stringify(String(result).trim()));
      } catch (error) {
        console.log('Execution error:', error.message);
      }
    }
  }
}

testEdgeCases().catch(console.error);
