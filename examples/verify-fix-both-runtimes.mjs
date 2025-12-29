#!/usr/bin/env node

// Verification script that works in both Bun and Node.js
import { $ } from '../js/src/$.mjs';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`=== Fix Verification for ${runtime} ===`);

const tests = [
  {
    name: 'Template literal without interpolation',
    test: async () => {
      const result = await $`echo hello`;
      return result.stdout.toString().trim() === 'hello';
    },
  },
  {
    name: 'String interpolation with complete command',
    test: async () => {
      const cmd = 'echo hello';
      const result = await $`${cmd}`;
      return result.stdout.toString().trim() === 'hello';
    },
  },
  {
    name: 'String interpolation with complex command',
    test: async () => {
      const cmd = 'echo hello | wc -w';
      const result = await $`${cmd}`;
      return result.stdout.toString().trim() === '1';
    },
  },
  {
    name: 'Mixed template literal with interpolation',
    test: async () => {
      const arg = 'hello';
      const result = await $`echo ${arg}`;
      return result.stdout.toString().trim() === 'hello';
    },
  },
  {
    name: 'Shell operators in interpolated commands',
    test: async () => {
      const cmd = 'test -f /bin/sh && echo "sh exists"';
      const result = await $`${cmd}`;
      return result.stdout.toString().trim() === 'sh exists';
    },
  },
];

let passed = 0;
let failed = 0;

for (const { name, test } of tests) {
  try {
    const success = await test();
    if (success) {
      console.log(`✓ ${name}`);
      passed++;
    } else {
      console.log(`✗ ${name} - assertion failed`);
      failed++;
    }
  } catch (error) {
    console.log(`✗ ${name} - error: ${error.message}`);
    failed++;
  }
}

console.log(`\nSummary: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? '🎉 All tests passed!' : '❌ Some tests failed');

process.exit(failed === 0 ? 0 : 1);
