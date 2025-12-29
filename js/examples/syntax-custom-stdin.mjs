#!/usr/bin/env node

// Custom stdin using $({ options })

import { $ } from '../js/src/$.mjs';

console.log('Custom stdin:');
const $withInput = $({ stdin: 'Hello from stdin!\n' });
const result = await $withInput`cat`;
console.log('Output:', result.stdout.trim());
