import { test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';

test('issue #43 - real-time streaming with shell operators', async () => {
  const startTime = Date.now();
  const cmd = $`sh -c 'echo "Output 1"; sleep 0.1; echo "Output 2"; sleep 0.1; echo "Output 3"'`;
  
  const chunks = [];
  const timestamps = [];
  
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      chunks.push(chunk.data.toString().trim());
      timestamps.push(Date.now() - startTime);
    }
  }
  
  expect(chunks).toEqual(['Output 1', 'Output 2', 'Output 3']);
  // Verify streaming is happening in real-time, not all at once
  expect(timestamps[0]).toBeLessThan(150); // First output should be immediate
  expect(timestamps[1]).toBeGreaterThan(80); // Second output after first sleep
  expect(timestamps[2]).toBeGreaterThan(180); // Third output after second sleep
}, 5000);

test('issue #43 - streaming with compound commands (semicolon)', async () => {
  const cmd = $`echo "first"; echo "second"`;
  const outputs = [];
  
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      outputs.push(chunk.data.toString().trim());
    }
  }
  
  // Shell commands may output in one or multiple chunks
  const combinedOutput = outputs.join('\n').trim();
  expect(combinedOutput).toBe('first\nsecond');
});

test('issue #43 - streaming with bash-specific constructs', async () => {
  const cmd = $`bash -c 'for i in {1..3}; do echo "Item $i"; done'`;
  const outputs = [];
  
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      outputs.push(chunk.data.toString().trim());
    }
  }
  
  const combinedOutput = outputs.join('\n').trim();
  expect(combinedOutput).toBe('Item 1\nItem 2\nItem 3');
});

test('issue #43 - streaming build-like process with progress', async () => {
  const cmd = $`bash -c 'echo "Starting..."; for i in 1 2; do echo "Step $i"; sleep 0.05; done; echo "Complete!"'`;
  const outputs = [];
  
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      outputs.push(chunk.data.toString().trim());
    }
  }
  
  const combinedOutput = outputs.join('\n').trim();
  expect(combinedOutput).toContain('Starting...');
  expect(combinedOutput).toContain('Step 1');
  expect(combinedOutput).toContain('Step 2');
  expect(combinedOutput).toContain('Complete!');
}, 2000);

test('issue #43 - long-running command interruption works', async () => {
  const cmd = $`bash -c 'for i in {1..10}; do echo "Line $i"; sleep 0.02; done'`;
  const outputs = [];
  let chunkCount = 0;
  
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      outputs.push(chunk.data.toString().trim());
      chunkCount++;
      if (chunkCount >= 2) {
        break; // Early exit to test stream interruption
      }
    }
  }
  
  // Should get at least one chunk before breaking
  expect(outputs.length).toBeGreaterThanOrEqual(1);
  const combinedOutput = outputs.join('\n');
  expect(combinedOutput).toContain('Line');
}, 3000);