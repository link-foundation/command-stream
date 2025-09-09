import { expect, test } from 'bun:test';
import { $ } from '../src/$.mjs';
import { Readable, Writable } from 'stream';

test('issue #19: result streams are proper stream instances', async () => {
  const result = await $`echo "hello world"`;
  
  // Test that result properties are actual stream instances
  expect(result.stdout instanceof Readable).toBe(true);
  expect(result.stderr instanceof Readable).toBe(true);
  expect(result.stdin instanceof Writable).toBe(true);
});

test('issue #19: result streams have stream methods', async () => {
  const result = await $`echo "test output"`;
  
  // Test that stream methods exist and are functions
  expect(typeof result.stdout.pipe).toBe('function');
  expect(typeof result.stdout.read).toBe('function');
  expect(typeof result.stdout.on).toBe('function');
  expect(typeof result.stdin.write).toBe('function');
  expect(typeof result.stdin.end).toBe('function');
});

test('issue #19: result streams are readable', async () => {
  const result = await $`echo "stream test"`;
  
  return new Promise((resolve) => {
    const chunks = [];
    
    result.stdout.on('data', (chunk) => {
      chunks.push(chunk.toString());
    });
    
    result.stdout.on('end', () => {
      const combinedData = chunks.join('');
      expect(combinedData).toBe('stream test\n');
      resolve();
    });
    
    // Trigger reading
    result.stdout.read();
  });
});

test('issue #19: result streams maintain backward compatibility', async () => {
  const result = await $`echo "compatibility test"`;
  
  // Test that string methods still work
  expect(result.stdout.toString()).toBe('compatibility test\n');
  expect(result.stdout.trim()).toBe('compatibility test');
  expect(result.stdout.length).toBe(19);
  expect(result.stdout.includes('compatibility')).toBe(true);
  expect(result.stdout.slice(0, 13)).toBe('compatibility');
});

test('issue #19: writable stdin stream', async () => {
  const result = await $`cat`;
  
  return new Promise((resolve) => {
    const chunks = [];
    
    result.stdin.on('data', (chunk) => {
      chunks.push(chunk.toString());
    });
    
    result.stdin.on('finish', () => {
      // Note: for this test, stdin won't have data since it's not connected to anything
      resolve();
    });
    
    result.stdin.write('test input\n');
    result.stdin.end();
  });
});

test('issue #19: non-virtual commands also use stream wrappers', async () => {
  const result = await $`node -e "console.log('non-virtual')"`;
  
  expect(result.stdout instanceof Readable).toBe(true);
  expect(result.stderr instanceof Readable).toBe(true);
  expect(result.stdin instanceof Writable).toBe(true);
  expect(result.stdout.toString()).toBe('non-virtual\n');
});

test('issue #19: empty streams work correctly', async () => {
  const result = await $`echo -n ""`;
  
  expect(result.stdout instanceof Readable).toBe(true);
  expect(result.stdout.toString()).toBe('');
  expect(result.stdout.length).toBe(0);
});

test('issue #19: stderr streams work correctly', async () => {
  const result = await $`node -e "console.error('error message')"`;
  
  return new Promise((resolve) => {
    const chunks = [];
    
    result.stderr.on('data', (chunk) => {
      chunks.push(chunk.toString());
    });
    
    result.stderr.on('end', () => {
      const combinedData = chunks.join('');
      expect(combinedData).toBe('error message\n');
      expect(result.stderr.toString()).toBe('error message\n');
      resolve();
    });
    
    // Trigger reading
    result.stderr.read();
  });
});

test('issue #19: JSON serialization compatibility', async () => {
  const result = await $`echo "json test"`;
  
  // Test that streams serialize to their string values
  const jsonString = JSON.stringify(result.stdout);
  expect(jsonString).toBe('"json test\\n"');
  
  const jsonObject = JSON.stringify(result);
  expect(jsonObject).toContain('"stdout":"json test\\n"');
});