#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Off Method Debug ===');

const cmd = $`echo "test"`;

// Override the off method to track when listeners are removed
const originalOff = cmd.off.bind(cmd);
cmd.off = function (event, listener) {
  console.log(`OFF called for event: ${event}`);
  console.log(`Listeners before off:`, this.listeners.size);

  // Get stack trace to see who's calling off
  const stack = new Error().stack;
  console.log('Stack trace:', stack.split('\n').slice(1, 4).join('\n'));

  const result = originalOff(event, listener);
  console.log(`Listeners after off:`, this.listeners.size);
  return result;
};

cmd.on('data', () => console.log('DATA listener called'));
cmd.on('end', () => console.log('END listener called'));
cmd.on('exit', () => console.log('EXIT listener called'));

await cmd;
