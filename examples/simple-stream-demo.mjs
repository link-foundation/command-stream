#!/usr/bin/env node

import { $ } from './$.mjs';

console.log('Testing simple streaming without jq...\n');

// First test: direct echo with delays
const startTime = Date.now();
const cmd = $`sh -c 'echo "line1"; sleep 0.5; echo "line2"; sleep 0.5; echo "line3"'`;

console.log('Starting stream...');

for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - startTime;
    console.log(`[${elapsed}ms] Got:`, chunk.data.toString().trim());
  }
}

console.log('\nNow testing with jq...');

// Now test with jq
const startTime2 = Date.now();
const cmd2 = $`echo '{"id":1}'`.pipe($`jq -c .`);

console.log('Starting jq stream...');

for await (const chunk of cmd2.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - startTime2;
    console.log(`[${elapsed}ms] Got from jq:`, chunk.data.toString().trim());
  }
}

console.log('\nTest complete');