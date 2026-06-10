#!/usr/bin/env node

// Custom working directory using $({ options })

import { $ } from '../src/$.mjs';

console.log('Custom working directory:');
const $inTmp = $({ cwd: '/tmp', mirror: false });
const result = await $inTmp`pwd`;
console.log('Current directory:', result.stdout.trim());
