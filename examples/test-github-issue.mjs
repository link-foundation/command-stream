#!/usr/bin/env node

import { $ } from '../src/$.mjs';

// Test the exact case from the GitHub issue
console.log("=== GitHub Issue #45 Test Case ===");

const arg = '"already quoted"';
console.log('Input:', arg);

const cmd = $({ mirror: false })`echo ${arg}`;
console.log('Generated command:', cmd.spec.command);

// According to the issue, this should result in: echo "already quoted"
// But it was generating: echo ''"already quoted"''
const hasDoubleQuoting = cmd.spec.command.includes('\'"already quoted"\'');
const hasCorrectOutput = cmd.spec.command === 'echo "already quoted"';

console.log('Has problematic double-quoting:', hasDoubleQuoting);
console.log('Has correct output:', hasCorrectOutput);

if (!hasCorrectOutput && !hasDoubleQuoting) {
  console.log('🔄 Different output - need to check if this is acceptable');
} else if (!hasDoubleQuoting) {
  console.log('✅ Fixed - no more double quoting!');
} else {
  console.log('❌ Still has double-quoting issue');
}