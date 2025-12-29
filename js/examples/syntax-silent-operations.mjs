#!/usr/bin/env node

// Silent operations (no mirror to stdout) using $({ options })

import { $ } from '../js/src/$.mjs';

console.log('Silent operation:');
const $silent = $({ mirror: false });
const result = await $silent`echo "This won't appear in terminal"`;
console.log('Captured output:', result.stdout.trim());
