#!/usr/bin/env node

// Enable verbose tracing
process.env.COMMAND_STREAM_VERBOSE = 'true';

import { $, disableVirtualCommands } from '../src/$.mjs';

console.log('=== Virtual Disable Debug ===');

console.log('1. Before disabling virtual commands:');
const cmd1 = $`echo "test1"`;
cmd1.start();
console.log('Immediate child1:', !!cmd1.child);
await cmd1;

console.log('2. After disabling virtual commands:');
disableVirtualCommands();
const cmd2 = $`echo "test2"`;
cmd2.start();
console.log('Immediate child2:', !!cmd2.child);
await cmd2;
