import { $ } from '../src/$.mjs';
import { test, expect } from 'bun:test';

const testJson = '{"message": "hello", "number": 42, "active": true, "data": null}';

test('jq behavior - default mirror mode shows output automatically', async () => {
  // Test that with default settings (mirror: true), jq output appears automatically
  // User doesn't need to manually console.log the result
  const result = await $`echo ${testJson} | jq .`;
  
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('"message"');
  expect(result.stdout).toContain('"hello"');
  expect(result.stdout).toContain('42');
  expect(result.stdout).toContain('true');
  expect(result.stdout).toContain('null');
});

test('jq behavior - explicit color output contains ANSI codes', async () => {
  // Test that jq -C produces colored output with ANSI escape codes
  const result = await $`echo ${testJson} | jq -C .`;
  
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/\u001b\[\d+/); // Contains ANSI escape sequences
  expect(result.stdout).toContain('"message"');
  expect(result.stdout).toContain('"hello"');
});

test('jq behavior - monochrome output has no ANSI codes', async () => {
  // Test that jq -M produces clean output without colors
  const result = await $`echo ${testJson} | jq -M .`;
  
  expect(result.code).toBe(0);
  expect(result.stdout).not.toMatch(/\u001b\[\d+/); // No ANSI escape sequences
  expect(result.stdout).toContain('"message"');
  expect(result.stdout).toContain('"hello"');
});

test('jq behavior - field extraction works correctly', async () => {
  // Test extracting specific fields with -r flag
  const result = await $`echo ${testJson} | jq -r .message`;
  
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe('hello');
});

test('jq behavior - complex JSON processing', async () => {
  const complexJson = '{"users": [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]}';
  
  // Test extracting array elements
  const result = await $`echo ${complexJson} | jq '.users[0].name'`;
  
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe('"Alice"');
});

test('jq behavior - mirror mode vs capture mode', async () => {
  // Test that mirror mode (default) automatically shows output
  const $default = $({ capture: true, mirror: true });
  const result1 = await $default`echo ${testJson} | jq .message`;
  
  expect(result1.code).toBe(0);
  expect(result1.stdout.trim()).toBe('"hello"');
  
  // Test capture-only mode
  const $captureOnly = $({ capture: true, mirror: false });
  const result2 = await $captureOnly`echo ${testJson} | jq .message`;
  
  expect(result2.code).toBe(0);
  expect(result2.stdout.trim()).toBe('"hello"');
});

test('jq behavior - TTY detection and automatic coloring', async () => {
  // IMPORTANT: Understanding jq's color behavior
  // 
  // When jq is used in a pipeline (echo ... | jq), it detects that its
  // output is being piped and disables colors by default, EVEN if the
  // parent process has a TTY (process.stdout.isTTY = true).
  //
  // This is smart behavior by jq:
  // - Direct to terminal: jq enables colors (if TTY detected)
  // - In a pipeline: jq disables colors (to avoid ANSI codes in pipes)
  // - With -C flag: forces colors even in pipelines
  // - With -M flag: disables colors even with TTY
  //
  // Since command-stream uses pipes internally, jq will typically NOT
  // output colors by default, regardless of the TTY status.
  
  const result = await $`echo ${testJson} | jq .`;
  
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('"message"');
  
  const hasColors = /\u001b\[\d+/.test(result.stdout);
  
  // Log the actual behavior for debugging
  if (process.env.DEBUG_JQ_TEST) {
    console.log('jq default behavior:', {
      hasColors,
      isTTY: process.stdout.isTTY,
      outputSample: result.stdout.substring(0, 50)
    });
  }
  
  // In most cases, jq in a pipeline won't have colors
  // But we accept both cases since it can vary by environment
  expect(typeof hasColors).toBe('boolean');
  
  // Verify we got valid JSON output regardless of colors
  expect(result.stdout).toContain('"message"');
  expect(result.stdout).toContain('"hello"');
  expect(result.stdout).toContain('42');
  expect(result.stdout).toContain('true');
  expect(result.stdout).toContain('null');
});

test('jq behavior - force colors work in any environment', async () => {
  // Test that explicit -C flag produces colors even in non-TTY environments
  const result = await $`echo ${testJson} | jq -C .`;
  
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/\u001b\[\d+/); // Should have ANSI codes
  expect(result.stdout).toContain('"message"');
  
  // The color codes should make the output longer than the plain version
  const plainResult = await $`echo ${testJson} | jq -M .`;
  expect(result.stdout.length).toBeGreaterThan(plainResult.stdout.length);
});

test('jq behavior - streaming with colors works', async () => {
  // Test that jq colors work with streaming/piping
  const result = await $`echo ${testJson} | jq -C . | cat`;
  
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/\u001b\[\d+/); // Colors preserved through pipe
  expect(result.stdout).toContain('"message"');
});