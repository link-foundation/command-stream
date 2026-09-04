#!/usr/bin/env node

// Combined multiple options using $({ options })

import { $ } from '../src/$.mjs';

console.log('Combined options:');
const $combined = $({
  stdin: 'test data for file',
  cwd: '/tmp',
  mirror: false,
  capture: true,
});

const filename = `test-${Date.now()}.txt`;
await $combined`cat > ${filename}`;
const verify = await $({ cwd: '/tmp', mirror: false })`cat ${filename}`;
console.log('Created file with content:', verify.stdout);
await $({ cwd: '/tmp', mirror: false })`rm ${filename}`;
