#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log("=== Understanding Template Literal Quoting ===");

const title = "Hello World";
console.log('Variable:', JSON.stringify(title));

console.log("\n1. No quotes in template:");
const cmd1 = $({ mirror: false })`echo ${title}`;
console.log('   Template: `echo ${title}`');
console.log('   Result:', cmd1.spec.command);

console.log("\n2. Double quotes in template:");
const cmd2 = $({ mirror: false })`echo "${title}"`;
console.log('   Template: `echo "${title}"`');
console.log('   Result:', cmd2.spec.command);
console.log('   Expected: echo "Hello World"');

console.log("\n3. Single quotes in template:");
const cmd3 = $({ mirror: false })`echo '${title}'`;
console.log('   Template: `echo \'${title}\'`');
console.log('   Result:', cmd3.spec.command);

console.log("\n=== Problem Analysis ===");
const hasDoubleQuoteIssue = cmd2.spec.command.includes("'Hello World'");
if (hasDoubleQuoteIssue) {
  console.log('❌ CONFIRMED: Double quotes in template cause single quotes to be added around interpolated values');
  console.log('   This breaks GitHub CLI and similar tools that expect clean string arguments');
} else {
  console.log('✅ No issue detected');
}