#!/usr/bin/env bun

// Test if Bun's process stdout streaming works properly

console.log('Test 1: Direct command that outputs with delays');
const proc1 = Bun.spawn(['sh', '-c', 'echo "1"; sleep 0.3; echo "2"; sleep 0.3; echo "3"'], {
  stdout: 'pipe',
  stderr: 'pipe'
});

const start1 = Date.now();
for await (const chunk of proc1.stdout) {
  const elapsed = Date.now() - start1;
  console.log(`[${elapsed}ms] Got chunk:`, Buffer.from(chunk).toString().trim());
}

console.log('\nTest 2: Command with jq pipeline');
const proc2 = Bun.spawn(['sh', '-c', './examples/emulate-claude-stream.mjs | jq .'], {
  stdout: 'pipe',
  stderr: 'pipe'
});

const start2 = Date.now();
let chunkCount = 0;
for await (const chunk of proc2.stdout) {
  chunkCount++;
  const elapsed = Date.now() - start2;
  const text = Buffer.from(chunk).toString();
  const lines = text.split('\n').filter(l => l.trim()).slice(0, 3); // Show first 3 lines
  console.log(`[${elapsed}ms] Chunk ${chunkCount}: ${lines.length} lines, first few:`, lines);
}

console.log('\nTest 3: Read stdout using different method');
const proc3 = Bun.spawn(['sh', '-c', './examples/emulate-claude-stream.mjs | jq .'], {
  stdout: 'pipe',
  stderr: 'pipe'  
});

const start3 = Date.now();
const reader = proc3.stdout.getReader();
let chunkCount3 = 0;

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkCount3++;
    const elapsed = Date.now() - start3;
    const text = Buffer.from(value).toString();
    const lines = text.split('\n').filter(l => l.trim()).slice(0, 3);
    console.log(`[${elapsed}ms] Reader chunk ${chunkCount3}: ${lines.length} lines, first few:`, lines);
  }
} finally {
  reader.releaseLock();
}