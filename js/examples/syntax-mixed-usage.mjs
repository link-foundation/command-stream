#!/usr/bin/env node

// Mix with regular $ usage

import { $ } from '../js/src/$.mjs';

console.log('Mixed usage:');
console.log('Regular $ (with mirror):');
await $`echo "This appears in terminal"`;

console.log('With options (no mirror):');
await $({ mirror: false })`echo "This doesn't appear"`;

console.log('Regular $ again:');
await $`echo "Back to normal"`;
