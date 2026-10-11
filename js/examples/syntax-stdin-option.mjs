#!/usr/bin/env node

// stdin option verification

import { $ } from '../src/$.mjs';

console.log('Verifying stdin option...');

const $stdin = $({ stdin: 'input\n' });
const result = await $stdin`cat`;
console.assert(result.stdout === 'input\n', 'stdin option failed');
console.log('✓ stdin option works');
