#!/usr/bin/env bun

// Test spawning processes individually and connecting them

const proc1 = Bun.spawn(['bun', 'run', 'examples/emulate-claude-stream.mjs'], {
  stdout: 'pipe',
  stderr: 'pipe'
});

const proc2 = Bun.spawn(['jq', '.'], {
  stdin: proc1.stdout,
  stdout: 'pipe', 
  stderr: 'pipe'
});

console.log('Testing direct process pipe connection:');
console.log('This SHOULD stream in real-time\n');

const start = Date.now();

// Read from jq's output
for await (const chunk of proc2.stdout) {
  const elapsed = Date.now() - start;
  const text = Buffer.from(chunk).toString();
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    console.log(`[${elapsed}ms] ${line}`);
  }
}

await proc1.exited;
await proc2.exited;