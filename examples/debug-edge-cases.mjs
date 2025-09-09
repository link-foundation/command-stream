#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log("=== Debugging Edge Cases ===");

console.log("\n1. Partial quotes:");
const value = "test";
const cmd1 = $({ mirror: false })`echo "${value}`;
console.log('Template: `echo "${value}`');
console.log('Result:', cmd1.spec.command);

const cmd2 = $({ mirror: false })`echo ${value}"`;
console.log('Template: `echo ${value}"`');
console.log('Result:', cmd2.spec.command);

console.log("\n2. Empty string edge case:");
const cmd3 = $({ mirror: false })`${""}${value}${""}`;
console.log('Template: `${""}${value}${""}`');
console.log('Result:', cmd3.spec.command);

console.log("\n3. Debugging string analysis:");
console.log('strings for case 1:', ['"echo "', '""']);
console.log('strings for case 2:', ['echo ', '""']);  
console.log('strings for case 3:', ['', '', '']);