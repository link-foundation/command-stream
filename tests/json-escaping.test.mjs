import { $ } from '../src/$.mjs';
import { test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import fs from 'fs';

test('JSON escaping - basic JSON string interpolation', async () => {
  const jsonData = { name: "test", value: "with 'quotes' and \"double quotes\"" };
  const jsonString = JSON.stringify(jsonData);
  
  // Test command generation
  const cmd = $({ mirror: false })`echo ${jsonString}`;
  expect(cmd.spec.command).toMatch(/^echo ".*"$/);
  
  // Test actual execution
  const result = await $({ capture: true, mirror: false })`echo ${jsonString}`;
  const parsed = JSON.parse(result.stdout.trim());
  
  expect(parsed.name).toBe("test");
  expect(parsed.value).toBe("with 'quotes' and \"double quotes\"");
});

test('JSON escaping - complex JSON with nested quotes and special characters', async () => {
  const jsonData = {
    name: "Test Project",
    description: "A project with \"quotes\" and 'apostrophes'",
    scripts: {
      test: "echo \"Running tests\"",
      build: "node build.js --env='production'"
    },
    config: {
      special: "Value with `backticks` and $variables"
    }
  };
  
  const jsonString = JSON.stringify(jsonData, null, 2);
  
  // Test that the JSON can be echoed and parsed back correctly
  const result = await $({ capture: true, mirror: false })`echo ${jsonString}`;
  const parsed = JSON.parse(result.stdout.trim());
  
  expect(parsed.name).toBe("Test Project");
  expect(parsed.description).toContain('"quotes"');
  expect(parsed.description).toContain("'apostrophes'");
  expect(parsed.scripts.test).toBe('echo "Running tests"');
  expect(parsed.config.special).toContain('`backticks`');
  expect(parsed.config.special).toContain('$variables');
});

test('JSON escaping - file redirection works with JSON strings', async () => {
  const jsonData = { test: "value with 'quotes'" };
  const jsonString = JSON.stringify(jsonData);
  const outputFile = '/tmp/json-test-' + Math.random().toString(36).substring(7) + '.json';
  
  try {
    // Write JSON to file using redirection
    await $`echo ${jsonString} > ${outputFile}`;
    
    // Read back and verify
    const fileContent = await fs.promises.readFile(outputFile, 'utf-8');
    const parsed = JSON.parse(fileContent.trim());
    
    expect(parsed.test).toBe("value with 'quotes'");
  } finally {
    // Cleanup
    try {
      await fs.promises.unlink(outputFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});

test('JSON escaping - JSON arrays are handled correctly', async () => {
  const jsonArray = [
    { name: "Item 1", value: "test 'with' quotes" },
    { name: "Item 2", value: 'another "test" case' }
  ];
  
  const jsonString = JSON.stringify(jsonArray);
  
  const result = await $({ capture: true, mirror: false })`echo ${jsonString}`;
  const parsed = JSON.parse(result.stdout.trim());
  
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed).toHaveLength(2);
  expect(parsed[0].value).toBe("test 'with' quotes");
  expect(parsed[1].value).toBe('another "test" case');
});

test('JSON escaping - non-JSON strings with braces use old logic', async () => {
  const nonJsonString = "{ this is not json but has braces }";
  
  const cmd = $({ mirror: false })`echo ${nonJsonString}`;
  
  // Should be quoted with single quotes since it's not JSON-like
  expect(cmd.spec.command).toBe("echo '{ this is not json but has braces }'");
});

test('JSON escaping - empty and edge case objects', async () => {
  const testCases = [
    {},
    { "": "" },
    { key: null },
    { key: true },
    { key: 123 }
  ];
  
  for (const testCase of testCases) {
    const jsonString = JSON.stringify(testCase);
    const result = await $({ capture: true, mirror: false })`echo ${jsonString}`;
    const parsed = JSON.parse(result.stdout.trim());
    
    expect(parsed).toEqual(testCase);
  }
});