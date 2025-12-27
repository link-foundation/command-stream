#!/usr/bin/env bun

// Test reading from multiple processes in pipeline simultaneously

console.log('=== Testing Multi-Stream Pipeline Reading ===\n');

const proc1 = Bun.spawn(['bun', 'run', 'examples/emulate-claude-stream.mjs'], {
  stdout: 'pipe',
  stderr: 'pipe',
});

// Use tee to split the stream so we can both pipe it and read it
const [readStream, pipeStream] = proc1.stdout.tee();

const proc2 = Bun.spawn(['jq', '.'], {
  stdin: pipeStream,
  stdout: 'pipe',
  stderr: 'pipe',
});

const start = Date.now();

// Read from proc1's tee'd stream for real-time updates
console.log('Reading from source (proc1):');
(async () => {
  for await (const chunk of readStream) {
    const elapsed = Date.now() - start;
    const text = Buffer.from(chunk).toString().trim();
    console.log(`  [${elapsed}ms] Source: ${text}`);
  }
})();

// Also read from proc2 to get the final jq output
console.log('\nReading from jq output (proc2):');
let jqOutput = '';
for await (const chunk of proc2.stdout) {
  const elapsed = Date.now() - start;
  const text = Buffer.from(chunk).toString();
  jqOutput += text;
  console.log(`  [${elapsed}ms] jq completed, ${chunk.length} bytes`);
}

console.log('\nFinal jq output:');
console.log(jqOutput);

await proc1.exited;
await proc2.exited;
