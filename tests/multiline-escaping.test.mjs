import { test, expect } from 'bun:test';
import { $ } from '../src/$.mjs';
import fs from 'fs';

test('multi-line strings with special characters should not be corrupted', async () => {
  const complexContent = `# Test Repository

This is a test repository with \`backticks\` and "quotes".

## Code Example
\`\`\`javascript
const message = "Hello, World!";
console.log(\`Message: \${message}\`);
\`\`\`

## Special Characters
- Single quotes: 'test'
- Double quotes: "test"
- Backticks: \`test\`
- Dollar signs: $100
- Backslashes: C:\\Windows\\System32`;

  const testFile = '/tmp/test-multiline-complex.txt';
  
  try {
    // This should now work correctly with the fix
    await $`echo "${complexContent}" > ${testFile}`;
    
    // Verify file was created and content matches
    expect(fs.existsSync(testFile)).toBe(true);
    
    const writtenContent = fs.readFileSync(testFile, 'utf8');
    expect(writtenContent).toBe(complexContent);
    
  } finally {
    // Clean up
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
});

test('multi-line strings with only newlines should be handled (no special processing)', async () => {
  const simpleMultiline = `Line 1
Line 2
Line 3`;
  
  // Simple multiline strings without special characters don't trigger our fix
  // They get regular quoting and are echoed to stdout (not redirected)
  const result = await $`echo "${simpleMultiline}" > /tmp/test`;
  
  // Should be echoed to stdout with quotes preserved
  expect(result.stdout).toContain('Line 1');
  expect(result.stdout).toContain('Line 2');
  expect(result.stdout).toContain('Line 3');
});

test('single line strings with special characters should work correctly', async () => {
  const singleLineComplex = 'This has backticks: `command` and dollar: $100';
  
  // Note: This test verifies that single-line content still works correctly
  // even though it doesn't trigger the complex multiline handling
  const result = await $`echo "${singleLineComplex}"`;
  
  // For single line, we expect it to be echoed to stdout (not redirected)
  expect(result.stdout.trim()).toBe(`'${singleLineComplex}'`);
});

test('empty strings should be handled correctly', async () => {
  const emptyContent = '';
  
  // Empty strings don't trigger our complex multiline handling
  const result = await $`echo "${emptyContent}" > /tmp/test`;
  
  // Should be echoed to stdout (empty quotes)
  expect(result.stdout).toContain("''");
});

test('strings with only special characters should work', async () => {
  const specialCharsOnly = '```\n$$$\n```';
  const testFile = '/tmp/test-special-chars.txt';
  
  try {
    await $`echo "${specialCharsOnly}" > ${testFile}`;
    
    expect(fs.existsSync(testFile)).toBe(true);
    const writtenContent = fs.readFileSync(testFile, 'utf8');
    expect(writtenContent).toBe(specialCharsOnly);
    
  } finally {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
});