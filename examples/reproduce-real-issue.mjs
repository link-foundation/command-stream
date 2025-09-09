#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log("=== Reproducing the Real GitHub Issue #45 ===");

// The REAL issue from the GitHub issue description:
// Template: `echo ${arg}` where arg = '"already quoted"'
// Expected: echo "already quoted" 
// Actual: echo ''"already quoted"'' (malformed)

const arg = '"already quoted"';
console.log('1. Variable value:', JSON.stringify(arg));

const cmd = $({ mirror: false })`echo ${arg}`;
console.log('2. Generated command:', cmd.spec.command);
console.log('3. Expected result: echo "already quoted"');

const hasProblem = cmd.spec.command.includes('\'\'') || cmd.spec.command.includes('""');
console.log('4. Has malformed quoting pattern:', hasProblem);

console.log("\n=== Testing the GitHub CLI scenario ===");

// This is what the issue is about - GitHub CLI titles with quotes
const issueTitle = "Implement Hello World in JavaScript";
console.log('1. Issue title:', JSON.stringify(issueTitle));

// When using double quotes around the interpolation 
const ghCmd = $({ mirror: false })`gh issue create --title "${issueTitle}"`;
console.log('2. GitHub CLI command generated:', ghCmd.spec.command);

// The expected command should be clean without nested quotes
const expectedCmd = `gh issue create --title "${issueTitle}"`;
console.log('3. Expected command:', expectedCmd);

const hasNestedQuotes = ghCmd.spec.command.includes('\'"') || ghCmd.spec.command.includes("'\"");
console.log('4. Has nested quotes issue:', hasNestedQuotes);

if (hasNestedQuotes) {
  console.log('❌ CONFIRMED: This would create GitHub issues with titles wrapped in quotes!');
} else {
  console.log('✅ FIXED: No nested quoting issue detected');
}