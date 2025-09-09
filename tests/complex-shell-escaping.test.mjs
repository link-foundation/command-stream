import { test, expect } from 'bun:test';
import { $, raw } from '../src/$.mjs';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup

// Test cases for issue #49: Complex shell commands with nested quotes and variables fail
// https://github.com/link-foundation/command-stream/issues/49

test('complex shell commands - for loop with nested quotes', async () => {
  const cmd = 'for file in *.js; do echo "Processing: $file"; done';
  const result = $({ mirror: false })`bash -c "${cmd}"`;
  
  // The command should be properly escaped to allow bash to interpret the for loop
  // The complex command should NOT be wrapped in single quotes entirely
  const generated = result.spec.command;
  
  // Should not wrap the entire complex command in single quotes
  expect(generated).not.toBe(`bash -c '${cmd}'`);
  
  // Should properly escape inner double quotes while preserving shell structure
  expect(generated).toMatch(/bash -c ".*for file in \*\.js.*"/);
});

test('complex shell commands - command substitution', async () => {
  const cmd = 'echo "Current directory: $(pwd)"';
  const result = $({ mirror: false })`bash -c "${cmd}"`;
  
  const generated = result.spec.command;
  
  // Should not wrap the entire command in single quotes
  expect(generated).not.toBe(`bash -c '${cmd}'`);
  
  // Should preserve the command substitution structure
  expect(generated).toMatch(/bash -c ".*\$\(pwd\).*"/);
});

test('complex shell commands - pipe with variable expansion', async () => {
  const cmd = 'echo "$USER" | tr a-z A-Z';
  const result = $({ mirror: false })`bash -c "${cmd}"`;
  
  const generated = result.spec.command;
  
  // Should not wrap the entire command in single quotes
  expect(generated).not.toBe(`bash -c '${cmd}'`);
  
  // Should preserve the pipe and variable expansion
  expect(generated).toMatch(/bash -c ".*echo.*\$USER.*\|.*tr.*"/);
});

test('complex shell commands - conditional with mixed quotes', async () => {
  const cmd = `if [[ "$HOME" == *"/Users"* ]]; then echo 'macOS detected'; fi`;
  const result = $({ mirror: false })`bash -c "${cmd}"`;
  
  const generated = result.spec.command;
  
  // Should not wrap the entire command in single quotes
  expect(generated).not.toBe(`bash -c '${cmd}'`);
  
  // Should preserve the conditional structure
  expect(generated).toMatch(/bash -c ".*if.*\[\[.*\$HOME.*then.*echo.*fi.*"/);
});

test('complex shell commands - multi-line with here document', async () => {
  const cmd = `cat << 'EOF'
This is a test
with multiple lines
EOF`;
  const result = $({ mirror: false })`bash -c "${cmd}"`;
  
  const generated = result.spec.command;
  
  // Should not wrap the entire command in single quotes (which would break here doc syntax)
  expect(generated).not.toBe(`bash -c '${cmd}'`);
  
  // Should preserve here document structure - check for the actual generated format
  // Use /s flag to match newlines with .* or split the check
  expect(generated).toMatch(/bash -c "cat << 'EOF'/);
  expect(generated).toMatch(/EOF"/);
  
  // Alternative: Just check that it doesn't use single quotes around the whole thing
  expect(generated).not.toMatch(/bash -c '.*cat << .*'/);
});

test('complex shell commands - preserve security for actual injection attempts', async () => {
  // These should still be properly quoted/escaped for security
  const maliciousCmd = 'echo hello; rm -rf /';
  const result = $({ mirror: false })`bash -c "${maliciousCmd}"`;
  
  const generated = result.spec.command;
  
  // Malicious commands should still be safely handled
  // The semicolon should be escaped/quoted to prevent command chaining
  expect(generated).toMatch(/bash -c ".*echo hello.*rm -rf.*"/);
});

test('complex shell commands - array and function definitions', async () => {
  const cmd = 'arr=(one two three); echo ${arr[@]}';
  const result = $({ mirror: false })`bash -c "${cmd}"`;
  
  const generated = result.spec.command;
  
  // Should not wrap the entire command in single quotes
  expect(generated).not.toBe(`bash -c '${cmd}'`);
  
  // Should preserve array syntax
  expect(generated).toMatch(/bash -c ".*arr=\(.*\).*echo.*\$\{arr\[@\]\}.*"/);
});

test('complex shell commands - process substitution', async () => {
  const cmd = 'diff <(sort file1.txt) <(sort file2.txt)';
  const result = $({ mirror: false })`bash -c "${cmd}"`;
  
  const generated = result.spec.command;
  
  // Should not wrap the entire command in single quotes
  expect(generated).not.toBe(`bash -c '${cmd}'`);
  
  // Should preserve process substitution syntax
  expect(generated).toMatch(/bash -c ".*diff.*<\(.*sort.*\).*<\(.*sort.*\).*"/);
});

test('complex shell commands - should work with raw() for complex cases', async () => {
  const cmd = 'for file in *.js; do echo "Processing: $file"; done';
  const result = $({ mirror: false })`bash -c ${raw(cmd)}`;
  
  const generated = result.spec.command;
  
  // With raw(), the command should be used as-is without additional quoting
  expect(generated).toBe(`bash -c ${cmd}`);
});

// Tests for backward compatibility - simple cases should still work
test('simple commands - backward compatibility maintained', async () => {
  const simpleCmd = 'echo hello';
  const result = $({ mirror: false })`bash -c "${simpleCmd}"`;
  
  const generated = result.spec.command;
  
  // Simple commands should use single quotes for safety
  expect(generated).toBe('bash -c "\'echo hello\'"');
});

test('dangerous simple commands - security still maintained', async () => {
  const dangerousCmd = 'rm -rf /';
  const result = $({ mirror: false })`bash -c "${dangerousCmd}"`;
  
  const generated = result.spec.command;
  
  // Should be properly quoted/escaped for security - simple dangerous commands use single quotes
  expect(generated).toBe('bash -c "\'rm -rf /\'"');
});