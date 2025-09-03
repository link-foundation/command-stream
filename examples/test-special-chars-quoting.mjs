#!/usr/bin/env node

// Test: Quoting strings with special characters
// Expected: Proper escaping and quoting for shell safety

import { $ } from '../src/$.mjs';

console.log('=== Test: Special Characters Quoting ===\n');

async function testSpecialChars() {
  const tests = [
    { desc: 'Single quote in string', input: "can't", testExec: true },
    { desc: 'Double quote in string', input: 'say "hello"', testExec: true },
    { desc: 'Dollar sign (variable)', input: '$HOME', testExec: true },
    { desc: 'Backtick (command sub)', input: '`date`', testExec: true },
    { desc: 'Semicolon (command sep)', input: 'first; second', testExec: true },
    { desc: 'Ampersand (background)', input: 'cmd &', testExec: false },
    { desc: 'Pipe character', input: 'a | b', testExec: false },
    { desc: 'Backslash', input: 'path\\to\\file', testExec: true },
    { desc: 'Newline', input: 'line1\nline2', testExec: true },
    { desc: 'Tab', input: 'col1\tcol2', testExec: true }
  ];
  
  for (const { desc, input, testExec } of tests) {
    console.log(`\n${desc}:`);
    console.log('Input:', JSON.stringify(input));
    
    const cmd = $({ mirror: false })`echo ${input}`;
    console.log('Generated:', cmd.spec.command);
    
    if (testExec) {
      try {
        const result = await $`echo ${input}`;
        const output = String(result).trim();
        console.log('Output:', JSON.stringify(output));
        
        // Check if special chars were properly escaped
        if (input === '$HOME' && output === '$HOME') {
          console.log('✅ Variable not expanded (properly escaped)');
        } else if (input === '`date`' && output === '`date`') {
          console.log('✅ Command substitution prevented (properly escaped)');
        } else if (output === input) {
          console.log('✅ Output matches input (properly escaped)');
        } else {
          console.log('⚠️  Output differs from input');
        }
      } catch (error) {
        console.log('Execution error:', error.message);
      }
    }
  }
}

testSpecialChars().catch(console.error);