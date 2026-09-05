import { $ } from '../src/$.mjs';
import { test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup

test('path interpolation - basic unquoted path', () => {
  const path = '/bin/echo';
  const cmd = $({ mirror: false })`${path} hello`;

  // With smart quoting, safe paths don't need quotes
  expect(cmd.spec.command).toBe('/bin/echo hello');
});

test('path interpolation - path with spaces gets quoted', () => {
  const path = '/path with spaces/command';
  const cmd = $({ mirror: false })`${path} hello`;

  expect(cmd.spec.command).toBe("'/path with spaces/command' hello");
});

test('path interpolation - path already wrapped in double quotes', () => {
  const path = '"/path/to/command"';
  const cmd = $({ mirror: false })`${path} hello`;

  // Should preserve the double quotes by wrapping in single quotes
  expect(cmd.spec.command).toBe('\'"/path/to/command"\' hello');
});

test('path interpolation - path already wrapped in single quotes', () => {
  const path = "'/path/to/command'";
  const cmd = $({ mirror: false })`${path} hello`;

  // With the fix, already-quoted paths should be used as-is when they don't contain internal quotes
  expect(cmd.spec.command).toBe("'/path/to/command' hello");
});

test('path interpolation - environment variable inheritance works', () => {
  const originalEnv = process.env.TEST_PATH;

  try {
    process.env.TEST_PATH = '/usr/bin/echo';
    const path = process.env.TEST_PATH;
    const cmd = $({ mirror: false })`${path} hello`;

    // Safe path doesn't need quotes
    expect(cmd.spec.command).toBe('/usr/bin/echo hello');
  } finally {
    if (originalEnv !== undefined) {
      process.env.TEST_PATH = originalEnv;
    } else {
      delete process.env.TEST_PATH;
    }
  }
});

test('path interpolation - complex path scenarios', () => {
  const testCases = [
    {
      name: 'Simple path',
      path: '/Users/konard/.claude/local/claude',
      expectedCommand: '/Users/konard/.claude/local/claude --version', // No quotes needed
    },
    {
      name: 'Path with spaces',
      path: '/Users/user name/.claude/local/claude',
      expectedCommand: "'/Users/user name/.claude/local/claude' --version", // Quotes needed
    },
    {
      name: 'Path with special characters',
      path: '/Users/user-name_123/.claude/local/claude',
      expectedCommand: '/Users/user-name_123/.claude/local/claude --version', // No quotes needed (dash and underscore are safe)
    },
  ];

  testCases.forEach(({ name, path, expectedCommand }) => {
    const cmd = $({ mirror: false })`${path} --version`;
    expect(cmd.spec.command).toBe(expectedCommand);
  });
});

test('path interpolation - stdin option with path works', () => {
  const path = '/bin/cat';
  const cmd = $({ stdin: 'test input\n', mirror: false })`${path}`;

  expect(cmd.spec.command).toBe('/bin/cat'); // Safe path, no quotes needed
  expect(cmd.options.stdin).toBe('test input\n');
});

test('path interpolation - command building works correctly', () => {
  const nonExistentPath = '/nonexistent/command';
  const cmd = $({ mirror: false })`${nonExistentPath} --version`;

  // Verify the command is built correctly (safe path, no quotes)
  expect(cmd.spec.command).toBe('/nonexistent/command --version');
  expect(cmd.spec.mode).toBe('shell');
});

test('path interpolation - fixed escaping for simple pre-quoted paths', () => {
  // This test verifies the fix for excessive escaping of pre-quoted paths
  // The issue was that paths like "'/path/to/command'" would get double-escaped

  const preQuotedPath = "'/path/to/command'"; // Already has single quotes
  const cmd = $({ mirror: false })`${preQuotedPath} --version`;

  // Fixed behavior: no excessive escaping for simple pre-quoted paths
  const generated = cmd.spec.command;
  expect(generated).not.toContain("\\'"); // Should NOT contain escaped quotes
  expect(generated).toBe("'/path/to/command' --version"); // Should use path as-is

  // The generated command should be valid shell syntax
  expect(generated).toMatch(/^'.*' --version$/);
});

test('path interpolation - environment variable scenario from GitHub issue', () => {
  const originalEnv = process.env.CLAUDE_PATH;

  try {
    // Simulate the exact scenario from the GitHub issue
    process.env.CLAUDE_PATH = '/Users/konard/.claude/local/claude';
    const claude =
      process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

    const cmd = $({
      stdin: 'hi\n',
      mirror: false,
    })`${claude} --output-format stream-json --verbose --model sonnet`;

    // Safe path, no quotes needed
    expect(cmd.spec.command).toBe(
      '/Users/konard/.claude/local/claude --output-format stream-json --verbose --model sonnet'
    );
    expect(cmd.options.stdin).toBe('hi\n');
    expect(cmd.options.mirror).toBe(false);

    // The command should be properly formatted for shell execution
    expect(cmd.spec.mode).toBe('shell');
  } finally {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_PATH = originalEnv;
    } else {
      delete process.env.CLAUDE_PATH;
    }
  }
});

test('path interpolation - improved handling of pre-quoted paths', () => {
  // Test that the improved quoting logic handles pre-quoted paths better
  const preQuotedPath = "'/path/to/claude'"; // Already has single quotes
  const cmd = $({ mirror: false })`${preQuotedPath} --version`;

  // With the fix, already-quoted paths should be used as-is when they don't contain internal quotes
  expect(cmd.spec.command).toBe("'/path/to/claude' --version");

  // Should not contain excessive escaping
  expect(cmd.spec.command).not.toContain("\\'");
  expect(cmd.spec.mode).toBe('shell');
});

test('path interpolation - handles complex quoting edge cases', () => {
  // Test various edge cases for the improved quoting logic

  // Case 1: Path with single quotes inside (should still escape properly)
  const pathWithInternalQuotes = "'/path/with'quotes/command'";
  const cmd1 = $({ mirror: false })`${pathWithInternalQuotes} --version`;
  // This should still use escaping because it has internal quotes
  expect(cmd1.spec.command).toContain("\\'");

  // Case 2: Empty quotes should be handled
  const emptyQuoted = "''";
  const cmd2 = $({ mirror: false })`echo ${emptyQuoted}`;
  expect(cmd2.spec.command).toBe("echo ''");

  // Case 3: Just quotes with no content
  const justQuotes = "'";
  const cmd3 = $({ mirror: false })`echo ${justQuotes}`;
  expect(cmd3.spec.command).toBe("echo ''\\'\'\'");

  // Case 4: Double-quoted paths should be wrapped in single quotes
  const doubleQuotedPath = '"/path/with spaces/command"';
  const cmd4 = $({ mirror: false })`${doubleQuotedPath} --version`;
  expect(cmd4.spec.command).toBe('\'"/path/with spaces/command"\' --version');
});

// Shell injection prevention tests
test('shell injection - command substitution attempt', () => {
  const malicious = '$(rm -rf /)';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted to prevent execution
  expect(cmd.spec.command).toBe("echo '$(rm -rf /)'");
});

test('shell injection - backtick command substitution', () => {
  const malicious = '`cat /etc/passwd`';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted
  expect(cmd.spec.command).toBe("echo '`cat /etc/passwd`'");
});

test('shell injection - semicolon command chaining', () => {
  const malicious = 'test; rm -rf /';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted to prevent command chaining
  expect(cmd.spec.command).toBe("echo 'test; rm -rf /'");
});

test('shell injection - pipe attempt', () => {
  const malicious = 'test | cat /etc/passwd';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted to prevent piping
  expect(cmd.spec.command).toBe("echo 'test | cat /etc/passwd'");
});

test('shell injection - AND operator attempt', () => {
  const malicious = 'test && malicious_command';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted
  expect(cmd.spec.command).toBe("echo 'test && malicious_command'");
});

test('shell injection - OR operator attempt', () => {
  const malicious = 'test || malicious_command';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted
  expect(cmd.spec.command).toBe("echo 'test || malicious_command'");
});

test('shell injection - background process attempt', () => {
  const malicious = 'test & malicious_command';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted
  expect(cmd.spec.command).toBe("echo 'test & malicious_command'");
});

test('shell injection - variable expansion attempt', () => {
  const malicious = '$PATH';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted to prevent variable expansion
  expect(cmd.spec.command).toBe("echo '$PATH'");
});

test('shell injection - glob expansion attempt', () => {
  const malicious = '*.txt';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted to prevent glob expansion
  expect(cmd.spec.command).toBe("echo '*.txt'");
});

test('shell injection - redirect attempt', () => {
  const malicious = '> /etc/passwd';
  const cmd = $({ mirror: false })`echo test ${malicious}`;

  // Should be safely quoted to prevent redirection
  expect(cmd.spec.command).toBe("echo test '> /etc/passwd'");
});

test('shell injection - newline injection', () => {
  const malicious = 'test\nmalicious_command';
  const cmd = $({ mirror: false })`echo ${malicious}`;

  // Should be safely quoted with newline preserved
  expect(cmd.spec.command).toBe("echo 'test\nmalicious_command'");
});

test('shell injection - complex injection attempt', () => {
  const malicious = '$(echo "pwned" > /tmp/pwned.txt)';
  const cmd = $({ mirror: false })`ls ${malicious}`;

  // Should be safely quoted
  expect(cmd.spec.command).toBe('ls \'$(echo "pwned" > /tmp/pwned.txt)\'');
});

test('safe strings - no unnecessary quoting', () => {
  const testCases = [
    { input: 'hello', expected: 'echo hello' },
    { input: 'test123', expected: 'echo test123' },
    { input: '/usr/bin/node', expected: 'echo /usr/bin/node' },
    { input: 'file.txt', expected: 'echo file.txt' },
    { input: 'user@host.com', expected: 'echo user@host.com' },
    { input: 'key=value', expected: 'echo key=value' },
    { input: 'path/to/file', expected: 'echo path/to/file' },
    { input: 'v1.2.3', expected: 'echo v1.2.3' },
  ];

  testCases.forEach(({ input, expected }) => {
    const cmd = $({ mirror: false })`echo ${input}`;
    expect(cmd.spec.command).toBe(expected);
  });
});

test('double-quoting prevention - user quotes with spaces', () => {
  // User quotes a path that actually needs quotes (has spaces)
  const pathWithSpaces = '/path with spaces/cmd';

  // User provides single quotes
  const singleQuoted = `'${pathWithSpaces}'`;
  const cmd1 = $({ mirror: false })`${singleQuoted} --test`;
  expect(cmd1.spec.command).toBe("'/path with spaces/cmd' --test");

  // User provides double quotes
  const doubleQuoted = `"${pathWithSpaces}"`;
  const cmd2 = $({ mirror: false })`${doubleQuoted} --test`;
  expect(cmd2.spec.command).toBe('\'"/path with spaces/cmd"\' --test');
});

test('double-quoting prevention - user quotes with special chars', () => {
  // User quotes a string with special characters
  const dangerous = 'test; echo INJECTED';

  // User provides single quotes
  const singleQuoted = `'${dangerous}'`;
  const cmd1 = $({ mirror: false })`echo ${singleQuoted}`;
  expect(cmd1.spec.command).toBe("echo 'test; echo INJECTED'");

  // User provides double quotes
  const doubleQuoted = `"${dangerous}"`;
  const cmd2 = $({ mirror: false })`echo ${doubleQuoted}`;
  expect(cmd2.spec.command).toBe('echo \'"test; echo INJECTED"\'');
});

test('double-quoting prevention - user unnecessarily quotes safe strings', () => {
  // User quotes a safe string that doesn't need quotes
  const safe = 'hello';

  // User provides single quotes (unnecessary)
  const singleQuoted = `'${safe}'`;
  const cmd1 = $({ mirror: false })`echo ${singleQuoted}`;
  expect(cmd1.spec.command).toBe("echo 'hello'");

  // User provides double quotes (unnecessary)
  const doubleQuoted = `"${safe}"`;
  const cmd2 = $({ mirror: false })`echo ${doubleQuoted}`;
  expect(cmd2.spec.command).toBe('echo \'"hello"\'');
});

test('double-quoting prevention - mixed scenarios', () => {
  const testCases = [
    {
      desc: 'Already single-quoted safe string',
      input: "'safe'",
      expected: "echo 'safe'",
    },
    {
      desc: 'Already double-quoted safe string',
      input: '"safe"',
      expected: 'echo \'"safe"\'',
    },
    {
      desc: 'Already single-quoted dangerous string',
      input: "'rm -rf /'",
      expected: "echo 'rm -rf /'",
    },
    {
      desc: 'Already double-quoted dangerous string',
      input: '"rm -rf /"',
      expected: 'echo \'"rm -rf /"\'',
    },
    {
      desc: 'Single-quoted path with spaces',
      input: "'/usr/local bin/app'",
      expected: "echo '/usr/local bin/app'",
    },
    {
      desc: 'Double-quoted path with spaces',
      input: '"/usr/local bin/app"',
      expected: 'echo \'"/usr/local bin/app"\'',
    },
  ];

  testCases.forEach(({ desc, input, expected }) => {
    const cmd = $({ mirror: false })`echo ${input}`;
    expect(cmd.spec.command).toBe(expected);
  });
});

test('strings requiring quotes - proper quoting applied', () => {
  const testCases = [
    { input: 'hello world', expected: "echo 'hello world'" },
    { input: 'test$var', expected: "echo 'test$var'" },
    { input: 'cmd;ls', expected: "echo 'cmd;ls'" },
    { input: 'a|b', expected: "echo 'a|b'" },
    { input: 'a&b', expected: "echo 'a&b'" },
    { input: 'a>b', expected: "echo 'a>b'" },
    { input: 'a<b', expected: "echo 'a<b'" },
    { input: 'a*b', expected: "echo 'a*b'" },
    { input: 'a?b', expected: "echo 'a?b'" },
    { input: 'a[b]c', expected: "echo 'a[b]c'" },
    { input: 'a{b}c', expected: "echo 'a{b}c'" },
    { input: 'a(b)c', expected: "echo 'a(b)c'" },
    { input: 'a!b', expected: "echo 'a!b'" },
    { input: 'a#b', expected: "echo 'a#b'" },
    { input: 'a%b', expected: "echo 'a%b'" },
    { input: 'a^b', expected: "echo 'a^b'" },
    { input: 'a~b', expected: "echo 'a~b'" },
    { input: 'a`b', expected: "echo 'a`b'" },
    { input: "a'b", expected: "echo 'a'\\''b'" },
    { input: 'a"b', expected: "echo 'a\"b'" },
    { input: 'a\\b', expected: "echo 'a\\b'" },
  ];

  testCases.forEach(({ input, expected }) => {
    const cmd = $({ mirror: false })`echo ${input}`;
    expect(cmd.spec.command).toBe(expected);
  });
});
