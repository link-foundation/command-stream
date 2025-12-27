#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Stream Generator Debug ===');

const cmd = $`echo "test"`;

cmd.on('data', () => console.log('DATA listener called'));
cmd.on('end', () => console.log('END listener called'));
cmd.on('exit', () => console.log('EXIT listener called'));

console.log('Listeners before getting stream generator:', cmd.listeners.size);

// Get the stream generator (this is what might be triggering the issue)
const streamGenerator = cmd.stream();

console.log('Listeners after getting stream generator:', cmd.listeners.size);

// Don't iterate the generator, just await the command
await cmd;

console.log('Listeners after await:', cmd.listeners.size);
