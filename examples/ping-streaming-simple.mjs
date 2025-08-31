#!/usr/bin/env node

// Simple ping streaming example - minimal code, maximum clarity

import { $ } from '../src/$.mjs';

console.log('Streaming ping output in real-time...\n');

for await (const chunk of $`ping -c 5 8.8.8.8`.stream()) {
  if (chunk.type === 'stdout') {
    console.log('Real-time output:', chunk.data.toString().trim());
  }
}