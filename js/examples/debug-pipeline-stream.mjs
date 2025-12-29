#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Pipeline Stream Debug ===');

const cmd = $`sh -c 'echo "test"' | jq -c .`;

// Instrument the stream method
const originalStream = cmd.stream.bind(cmd);
cmd.stream = function () {
  console.log('stream() called for pipeline');

  const generator = originalStream();

  const originalNext = generator.next.bind(generator);
  generator.next = function () {
    console.log('pipeline generator.next() called');
    const promise = originalNext();

    promise
      .then((result) => {
        console.log('pipeline generator.next() resolved:', {
          done: result.done,
          hasValue: !!result.value,
          valueType: result.value?.type,
        });
      })
      .catch((err) => {
        console.log('pipeline generator.next() error:', err.message);
      });

    return promise;
  };

  return generator;
};

const timeout = setTimeout(() => {
  console.log('TIMEOUT: Pipeline stream took too long');
  process.exit(1);
}, 5000);

try {
  let count = 0;
  console.log('Starting pipeline stream...');
  for await (const chunk of cmd.stream()) {
    count++;
    console.log(
      `Pipeline chunk ${count}:`,
      chunk.type,
      JSON.stringify(chunk.data.toString().trim())
    );

    if (count >= 3) {
      console.log('Breaking after 3 chunks');
      break;
    }
  }

  clearTimeout(timeout);
  console.log('Pipeline stream completed with', count, 'chunks');
} catch (error) {
  clearTimeout(timeout);
  console.log('Pipeline stream error:', error.message);
}
