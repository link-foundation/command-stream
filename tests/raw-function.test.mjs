import { test, expect, describe, beforeEach } from 'bun:test';
import './test-helper.mjs';
import { $, raw, shell, disableVirtualCommands } from '../src/$.mjs';

// Disable virtual commands for consistent system command behavior
beforeEach(() => {
  shell.errexit(false);
  disableVirtualCommands();
});

describe('raw() function - Disable auto-escape', () => {
  describe('basic functionality', () => {
    test('should create raw object with string', () => {
      const result = raw('test command');
      expect(result).toEqual({ raw: 'test command' });
    });

    test('should convert numbers to string', () => {
      expect(raw(123)).toEqual({ raw: '123' });
    });

    test('should convert boolean to string', () => {
      expect(raw(true)).toEqual({ raw: 'true' });
      expect(raw(false)).toEqual({ raw: 'false' });
    });

    test('should handle empty string', () => {
      expect(raw('')).toEqual({ raw: '' });
    });
  });

  describe('command execution with raw()', () => {
    test('should execute simple raw command', async () => {
      const cmd = raw('echo "hello world"');
      const result = await $`${cmd}`;
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.code).toBe(0);
    });

    test('should execute command with && operator', async () => {
      const cmd = raw('echo "step1" && echo "step2"');
      const result = await $`${cmd}`;
      expect(result.stdout).toContain('step1');
      expect(result.stdout).toContain('step2');
      expect(result.code).toBe(0);
    });

    test('should execute command with || operator', async () => {
      const cmd = raw('false || echo "fallback"');
      const result = await $`${cmd}`;
      expect(result.stdout.trim()).toBe('fallback');
    });

    test('should execute command with pipe', async () => {
      const cmd = raw('echo "hello world" | wc -w');
      const result = await $`${cmd}`;
      expect(result.stdout.trim()).toBe('2');
      expect(result.code).toBe(0);
    });

    test('should execute command with semicolon', async () => {
      const cmd = raw('echo "first"; echo "second"');
      const result = await $`${cmd}`;
      expect(result.stdout).toContain('first');
      expect(result.stdout).toContain('second');
      expect(result.code).toBe(0);
    });

    test('should handle command with subshell', async () => {
      const cmd = raw('echo "outer: $(echo inner)"');
      const result = await $`${cmd}`;
      expect(result.stdout.trim()).toBe('outer: inner');
      expect(result.code).toBe(0);
    });

    test('should handle command with wildcards', async () => {
      const cmd = raw('echo test-*.mjs | head -c 20');
      const result = await $`${cmd}`;
      // Should execute wildcard expansion
      expect(result.code).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });
  });

  describe('combining raw() with safe interpolation', () => {
    test('should mix raw command with safe variable', async () => {
      const safeInput = 'test';
      const result = await $`${raw('echo "prefix:"')} ${safeInput}`;
      expect(result.stdout.trim()).toBe('prefix: test');
    });

    test('should safely quote user input when mixed with raw', async () => {
      const userInput = 'test; rm -rf /';
      const result = await $`${raw('echo "User said:"')} ${userInput}`;
      // User input should be safely quoted even when mixed with raw
      expect(result.stdout).toContain('User said:');
      expect(result.stdout).toContain('test; rm -rf /');
      // Command should not execute the rm part
      expect(result.code).toBe(0);
    });

    test('should handle multiple raw() calls in one command', async () => {
      const cmd1 = raw('echo "part1"');
      const cmd2 = raw('&& echo "part2"');
      const result = await $`${cmd1} ${cmd2}`;
      expect(result.stdout).toContain('part1');
      expect(result.stdout).toContain('part2');
    });
  });

  describe('comparison with normal interpolation', () => {
    test('raw() executes shell operators, normal interpolation escapes them', async () => {
      const cmdString = 'echo "test" && echo "test2"';

      // With raw() - executes both commands
      const rawResult = await $`${raw(cmdString)}`;
      expect(rawResult.stdout).toContain('test');
      expect(rawResult.stdout).toContain('test2');

      // Without raw() - treats as literal string
      const normalResult = await $`echo ${cmdString}`;
      expect(normalResult.stdout.trim()).toBe(cmdString);
      expect(normalResult.stdout).not.toMatch(/test\s+test2/); // Should be one line
    });

    test('raw() allows pipes, normal interpolation escapes them', async () => {
      const cmdString = 'echo "hello world" | wc -w';

      // With raw() - executes pipe
      const rawResult = await $`${raw(cmdString)}`;
      expect(rawResult.stdout.trim()).toBe('2');

      // Without raw() - treats pipe as literal
      const normalResult = await $`echo ${cmdString}`;
      expect(normalResult.stdout).toContain('|');
      expect(normalResult.stdout).toContain('wc');
    });

    test('raw() allows command substitution, normal interpolation escapes it', async () => {
      const cmdString = '$(echo test)';

      // With raw() - executes substitution
      const rawResult = await $`echo ${raw(cmdString)}`;
      expect(rawResult.stdout.trim()).toBe('test');

      // Without raw() - treats as literal
      const normalResult = await $`echo ${cmdString}`;
      expect(normalResult.stdout.trim()).toBe('$(echo test)');
    });
  });

  describe('edge cases', () => {
    test('should handle raw() with quotes in command', async () => {
      const cmd = raw('echo "single\'quote" "double\\"quote"');
      const result = await $`${cmd}`;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('single');
      expect(result.stdout).toContain('quote');
    });

    test('should handle raw() with environment variables', async () => {
      const cmd = raw('echo $HOME');
      const result = await $`${cmd}`;
      expect(result.stdout.trim().length).toBeGreaterThan(0);
      expect(result.stdout.trim()).not.toBe('$HOME');
    });

    test('should handle raw() with newlines', async () => {
      const cmd = raw('echo "line1"\necho "line2"');
      const result = await $`${cmd}`;
      expect(result.stdout).toContain('line1');
      expect(result.stdout).toContain('line2');
    });

    test('should handle raw() at different positions', async () => {
      // At start
      const result1 = await $`${raw('echo "start"')} end`;
      expect(result1.stdout.trim()).toContain('start');

      // In middle
      const result2 = await $`echo start ${raw('&& echo "middle"')} end`;
      expect(result2.stdout).toContain('middle');

      // At end
      const result3 = await $`echo start ${raw('&& echo "end"')}`;
      expect(result3.stdout).toContain('end');
    });
  });

  describe('practical use cases', () => {
    test('configuration-based commands', async () => {
      const config = {
        buildCommand: raw('echo "Building..." && echo "Done"'),
        testCommand: raw('echo "Testing..." && echo "Passed"'),
      };

      const buildResult = await $`${config.buildCommand}`;
      expect(buildResult.stdout).toContain('Building');
      expect(buildResult.stdout).toContain('Done');

      const testResult = await $`${config.testCommand}`;
      expect(testResult.stdout).toContain('Testing');
      expect(testResult.stdout).toContain('Passed');
    });

    test('complex shell pipelines', async () => {
      const pipeline = raw('seq 1 10 | head -n 3 | tail -n 1');
      const result = await $`${pipeline}`;
      expect(result.stdout.trim()).toBe('3');
    });

    test('conditional execution chains', async () => {
      const successChain = raw('true && echo "success"');
      const result1 = await $`${successChain}`;
      expect(result1.stdout.trim()).toBe('success');

      const failChain = raw('false && echo "should not print"');
      const result2 = await $`${failChain}`;
      expect(result2.stdout.trim()).toBe('');
    });
  });

  describe('security demonstrations', () => {
    test('normal interpolation prevents injection', async () => {
      const malicious = '; rm -rf /tmp/test';
      const result = await $`echo ${malicious}`;

      // Should safely output the string, not execute rm
      expect(result.stdout).toContain('; rm -rf /tmp/test');
      expect(result.code).toBe(0);
    });

    test('raw() would execute injection (demonstration only)', async () => {
      // We demonstrate the danger without actually running dangerous commands
      const dangerous = raw(
        'echo "safe" ; echo "This would be dangerous with rm -rf"'
      );
      const result = await $`${dangerous}`;

      // Both parts execute because raw() disables escaping
      expect(result.stdout).toContain('safe');
      expect(result.stdout).toContain('dangerous');
    });
  });

  describe('error handling', () => {
    test('should handle failing commands in raw()', async () => {
      const cmd = raw('false');
      const result = await $`${cmd}`;
      expect(result.code).toBe(1);
    });

    test('should handle non-existent commands in raw()', async () => {
      const cmd = raw('nonexistent-command-12345');
      const result = await $`${cmd}`;
      expect(result.code).not.toBe(0);
    });

    test('should handle syntax errors in raw()', async () => {
      // Invalid shell syntax
      const cmd = raw('echo "unclosed quote');
      const result = await $`${cmd}`;
      expect(result.code).not.toBe(0);
    });
  });
});
