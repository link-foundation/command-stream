#!/usr/bin/env node

import { $, disableVirtualCommands } from '../src/$.mjs';

console.log('=== Event Emission Debug ===');

// Override emit to trace when events are emitted
function instrumentEmitter(cmd, label) {
  const originalEmit = cmd.emit.bind(cmd);
  cmd.emit = function (event, ...args) {
    console.log(`[${label}] EMIT: ${event}`, args.length > 0 ? args[0] : '');
    return originalEmit(event, ...args);
  };
}

async function testWithInstrumentation() {
  console.log('\n1. Virtual echo with emit tracing:');
  const virtualCmd = $`echo "virtual"`;
  instrumentEmitter(virtualCmd, 'VIRTUAL');

  virtualCmd.on('data', () => console.log('[VIRTUAL] RECEIVED: data'));
  virtualCmd.on('end', () => console.log('[VIRTUAL] RECEIVED: end'));
  virtualCmd.on('exit', () => console.log('[VIRTUAL] RECEIVED: exit'));

  await virtualCmd;

  console.log('\n2. Real echo with emit tracing:');
  disableVirtualCommands();
  const realCmd = $`echo "real"`;
  instrumentEmitter(realCmd, 'REAL');

  realCmd.on('data', () => console.log('[REAL] RECEIVED: data'));
  realCmd.on('end', () => console.log('[REAL] RECEIVED: end'));
  realCmd.on('exit', () => console.log('[REAL] RECEIVED: exit'));

  await realCmd;
}

await testWithInstrumentation();
console.log('\nDebug completed!');
