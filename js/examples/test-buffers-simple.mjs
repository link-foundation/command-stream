#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('Testing buffer access...');

async function testBuffers() {
  const cmd = $`echo "test buffer"`;

  // First access - should be promise
  console.log('Getting buffer (first access)...');
  const buffer1 = await cmd.buffers.stdout;
  console.log('Buffer 1:', buffer1.toString());

  // Check if process is finished
  console.log('Process finished?', cmd.finished);
  console.log('Has outChunks?', !!cmd.outChunks);
  console.log(
    'OutChunks length:',
    cmd.outChunks ? cmd.outChunks.length : 'null'
  );

  // Second access - should be immediate
  console.log('Getting buffer (second access)...');
  const buffer2 = cmd.buffers.stdout;
  console.log('Buffer 2 type:', typeof buffer2);
  console.log('Buffer 2 is Promise?', buffer2 instanceof Promise);
  if (!(buffer2 instanceof Promise)) {
    console.log('Buffer 2 content:', buffer2.toString());
  } else {
    console.log('Buffer 2 resolved:', (await buffer2).toString());
  }
}

testBuffers().catch(console.error);
