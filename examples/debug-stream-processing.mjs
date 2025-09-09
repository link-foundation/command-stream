#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('🔍 Debug Stream Processing\n');

// Test basic stream() functionality
console.log('1. Testing basic stream()');
const basic = $`printf "1\\n2\\n3\\n"`;

for await (const chunk of basic.stream()) {
  console.log('Basic chunk:', {
    type: chunk.type,
    data: JSON.stringify(chunk.data.toString()),
    preview: chunk.data.toString().slice(0, 20)
  });
}

console.log('\n2. Testing map() functionality');
const mapped = $`printf "1\\n2\\n3\\n"`.map(line => {
  console.log('Map input:', JSON.stringify(line));
  const num = parseInt(line.trim());
  const result = num * 2;
  console.log('Map output:', result);
  return result;
});

for await (const chunk of mapped) {
  console.log('Mapped chunk:', {
    type: chunk.type,
    data: JSON.stringify(chunk.data.toString()),
    originalData: chunk.originalData ? JSON.stringify(chunk.originalData.toString()) : 'none'
  });
}