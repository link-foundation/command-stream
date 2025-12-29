#!/usr/bin/env node

// Reusable configurations using $({ options })

import { $ } from '../js/src/$.mjs';

console.log('Reusable configurations:');
const $debug = $({
  env: { ...process.env, DEBUG: 'true' },
  mirror: false,
});

// Run multiple commands with same configuration
const result1 = await $debug`echo "Command 1"`;
console.log('DEBUG mode result:', result1.stdout.trim());

const result2 = await $debug`echo "Command 2"`;
console.log('DEBUG mode result:', result2.stdout.trim());

const result3 = await $debug`echo "Command 3"`;
console.log('DEBUG mode result:', result3.stdout.trim());
