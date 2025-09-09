import { $ } from '../src/$.mjs';
import { test, expect } from 'bun:test';
import './test-helper.mjs';

// Tests for GitHub Issue #45 - Automatic quote addition in interpolation causes issues

test('template quoting - double quotes in template preserve intended quoting', () => {
  const title = "Hello World";
  const cmd = $({ mirror: false })`echo "${title}"`;
  
  // Should NOT add extra quotes around the interpolated value
  expect(cmd.spec.command).toBe('echo "Hello World"');
});

test('template quoting - single quotes in template preserve intended quoting', () => {
  const title = "Hello World";
  const cmd = $({ mirror: false })`echo '${title}'`;
  
  // Should NOT add extra quotes around the interpolated value
  expect(cmd.spec.command).toBe("echo 'Hello World'");
});

test('template quoting - no quotes in template applies safety quoting', () => {
  const title = "Hello World";
  const cmd = $({ mirror: false })`echo ${title}`;
  
  // Should apply safety quoting since there are spaces
  expect(cmd.spec.command).toBe("echo 'Hello World'");
});

test('template quoting - GitHub CLI issue title scenario', () => {
  const issueTitle = "Implement Hello World in JavaScript";
  const cmd = $({ mirror: false })`gh issue create --title "${issueTitle}"`;
  
  // This was the original problem - should NOT wrap in single quotes
  expect(cmd.spec.command).toBe('gh issue create --title "Implement Hello World in JavaScript"');
  
  // Should NOT contain nested quoting
  expect(cmd.spec.command).not.toContain('\'"');
  expect(cmd.spec.command).not.toContain("'\"");
});

test('template quoting - mixed quote types work correctly', () => {
  const value = "test value";
  
  // Different quote combinations should work
  const cmd1 = $({ mirror: false })`git commit -m "${value}"`;
  expect(cmd1.spec.command).toBe('git commit -m "test value"');
  
  const cmd2 = $({ mirror: false })`git commit -m '${value}'`;
  expect(cmd2.spec.command).toBe("git commit -m 'test value'");
});

test('template quoting - complex interpolation with shell operators', () => {
  const filename = "my file.txt";
  const content = "Hello World";
  
  const cmd = $({ mirror: false })`echo "${content}" > "${filename}"`;
  
  // Both interpolations should respect the template quotes
  expect(cmd.spec.command).toBe('echo "Hello World" > "my file.txt"');
});

test('template quoting - safety preserved for unquoted dangerous values', () => {
  const dangerous = "test; rm -rf /";
  const cmd = $({ mirror: false })`echo ${dangerous}`;
  
  // Should still apply safety quoting for dangerous content
  expect(cmd.spec.command).toBe("echo 'test; rm -rf /'");
});

test('template quoting - partial quotes are handled safely', () => {
  const value = "test";
  
  // Only one side quoted - should NOT add extra quoting (malformed template)
  const cmd1 = $({ mirror: false })`echo "${value}`;
  expect(cmd1.spec.command).toBe('echo "test');
  
  const cmd2 = $({ mirror: false })`echo ${value}"`;
  expect(cmd2.spec.command).toBe('echo test"');
});

test('template quoting - edge case with empty strings', () => {
  const value = "test";
  
  // Empty string parts create quote pairs around each interpolation
  const cmd = $({ mirror: false })`${""}${value}${""}`;
  expect(cmd.spec.command).toBe("''test''");
});

test('template quoting - preserves existing quote handling for variable content', () => {
  // When the variable itself contains quotes, original behavior should be preserved
  const quotedVar = '"already quoted"';
  const cmd = $({ mirror: false })`echo ${quotedVar}`;
  
  // Should wrap the quoted variable for safety (existing behavior)
  expect(cmd.spec.command).toBe('echo \'"already quoted"\'');
});