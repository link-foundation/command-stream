#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Listener Interference Debug ===');

async function testWithoutStream() {
  console.log('\n1. Test without calling stream():');
  const cmd = $`echo "test1"`;

  cmd.on('end', () => console.log('END listener called'));
  cmd.on('exit', () => console.log('EXIT listener called'));

  console.log('Listeners before await:', cmd.listeners);
  await cmd;
  console.log('Listeners after await:', cmd.listeners);
}

async function testWithStream() {
  console.log('\n2. Test after calling stream():');
  const cmd = $`echo "test2"`;

  cmd.on('end', () => console.log('END listener called'));
  cmd.on('exit', () => console.log('EXIT listener called'));

  console.log('Listeners before stream():', cmd.listeners);

  // Just call stream() to get the generator, but don't iterate
  const streamGen = cmd.stream();

  console.log('Listeners after stream():', cmd.listeners);

  await cmd;
  console.log('Listeners after await:', cmd.listeners);
}

await testWithoutStream();
await testWithStream();
