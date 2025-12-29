#!/usr/bin/env node

// Custom environment using $({ options })

import { $ } from '../js/src/$.mjs';

console.log('Custom environment:');
const $withEnv = $({
  env: { ...process.env, DEMO_VAR: 'custom_value' },
  mirror: false,
});
const result = await $withEnv`printenv DEMO_VAR`;
console.log('DEMO_VAR =', result.stdout.trim());
