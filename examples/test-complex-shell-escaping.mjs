#!/usr/bin/env bun
// Test case for complex shell command escaping issue #49
// Based on: https://github.com/deep-assistant/hive-mind/blob/main/command-stream-issues/issue-13-complex-shell-escaping.mjs

import { $ } from '../src/$.mjs';

console.log('=== Complex Shell Command Escaping Tests ===\n');

// Test case 1: The main issue from the GitHub report
console.log('1. Testing complex for loop with nested quotes:');
const cmd1 = 'for file in *.js; do echo "Processing: $file"; done';
try {
  const result1 = $({ mirror: false })`bash -c "${cmd1}"`;
  console.log('Generated command:', result1.spec.command);
  console.log('Expected: bash -c "for file in *.js; do echo \\"Processing: $file\\"; done"');
  console.log('Status: The complex command gets over-quoted, preventing shell interpretation');
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n2. Testing nested command substitution:');
const cmd2 = 'echo "Current directory: $(pwd)"';
try {
  const result2 = $({ mirror: false })`bash -c "${cmd2}"`;
  console.log('Generated command:', result2.spec.command);
  console.log('Expected: bash -c "echo \\"Current directory: $(pwd)\\""');
  console.log('Status: Command substitution gets quoted, preventing execution');
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n3. Testing pipe with variable expansion:');
const cmd3 = 'echo "$USER" | tr a-z A-Z';
try {
  const result3 = $({ mirror: false })`bash -c "${cmd3}"`;
  console.log('Generated command:', result3.spec.command);
  console.log('Expected: bash -c "echo \\"$USER\\" | tr a-z A-Z"');
  console.log('Status: Pipe and variable expansion get quoted, preventing proper shell behavior');
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n4. Testing multi-line command with here document:');
const cmd4 = `cat << 'EOF'
This is a multi-line
message with $variables
and "quotes"
EOF`;
try {
  const result4 = $({ mirror: false })`bash -c "${cmd4}"`;
  console.log('Generated command:', result4.spec.command);
  console.log('Expected: Multi-line here document should be properly escaped');
  console.log('Status: Here document gets entirely single-quoted, breaking syntax');
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n5. Testing conditional with mixed quoting:');
const cmd5 = `if [[ "$HOME" == *"/Users"* ]]; then echo 'macOS detected'; fi`;
try {
  const result5 = $({ mirror: false })`bash -c "${cmd5}"`;
  console.log('Generated command:', result5.spec.command);
  console.log('Expected: Conditional should preserve both single and double quotes');
  console.log('Status: Mixed quoting gets over-escaped');
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== Analysis ===');
console.log('The root issue is that complex shell commands passed as template literal');
console.log('variables get treated as simple strings and wrapped in single quotes,');
console.log('which prevents the shell from interpreting the command structure.');
console.log('');
console.log('Current behavior: All interpolated values are wrapped in single quotes');
console.log('Needed behavior: Context-aware escaping that preserves shell syntax');
console.log('when appropriate while still preventing injection attacks.');