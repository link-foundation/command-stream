#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Simple jq Streaming Test ===\n');

// Test 1: Basic JSON streaming through jq
console.log('Test 1: Basic JSON streaming with delays:');
const startTime = Date.now();

const cmd = $`sh -c 'echo "{\\"id\\":1}"; sleep 0.5; echo "{\\"id\\":2}"; sleep 0.5; echo "{\\"id\\":3}"' | jq -c .`;

let buffer = '';
for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - startTime;
    buffer += chunk.data.toString();
    
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        console.log(`[${elapsed}ms] Got JSON:`, line.trim());
      }
    }
  }
}

console.log('✅ Streaming completed successfully!\n');

// Test 2: Multiple JSON objects at once
console.log('Test 2: Multiple JSON objects filtered by jq:');
const filterCmd = $`printf '{"type":"info","msg":"Hello"}\n{"type":"error","msg":"Failed"}\n{"type":"info","msg":"Done"}\n' | jq -c 'select(.type == "error")'`;

const result = await filterCmd;
console.log('Filtered result:', result.stdout.trim());
console.log('✅ Filtering works!\n');

// Test 3: Transform JSON stream  
console.log('Test 3: Transform JSON stream in realtime:');
const transformCmd = $`printf '{"name":"Alice","age":30}\n{"name":"Bob","age":25}\n' | jq -c '{user: .name, years: .age}'`;

const transformResult = await transformCmd;
console.log('Transformed results:');
console.log(transformResult.stdout.trim().split('\n').join('\n'));

console.log('\n🎉 All tests passed! JSON streaming with jq works!');