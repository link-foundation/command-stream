#!/usr/bin/env node

import { $ } from '../$.mjs';

console.log('Testing interactive command detection...');

// Test 1: Check if top is detected as interactive
const isTop = $`top`; 

console.log('Created top command process');

// Test 2: Check if ls is detected as non-interactive 
const isLs = $`ls`;

console.log('Created ls command process');

console.log('Interactive command detection test completed');