import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { $ as $original } from '../src/$.mjs';
import { $, cd, echo, fs, path, os } from '../src/zx-compat.mjs';

// Store initial working directory
let initialCwd;

beforeEach(() => {
  initialCwd = process.cwd();
});

afterEach(() => {
  // Restore working directory
  process.chdir(initialCwd);
});

describe('zx Compatibility', () => {
  describe('$.zx Basic Functionality', () => {
    test('should support zx-style template literal execution', async () => {
      const result = await $original.zx`echo "Hello World"`;
      
      expect(result).toBeDefined();
      expect(result.stdout).toContain('Hello World');
      expect(result.exitCode).toBe(0);
      expect(result.code).toBe(0); // zx alias
    });

    test('should support variable interpolation', async () => {
      const message = 'test message';
      const result = await $original.zx`echo "${message}"`;
      
      expect(result.stdout).toContain('test message');
      expect(result.exitCode).toBe(0);
    });

    test('should have toString() method that returns stdout', async () => {
      const result = await $original.zx`echo "Hello World"`;
      const stringified = result.toString();
      
      expect(stringified).toContain('Hello World');
    });
  });

  describe('Error Handling', () => {
    test('should throw by default on non-zero exit codes', async () => {
      await expect($original.zx`exit 1`).rejects.toThrow('Command failed with exit code 1');
    });

    test('should have error properties on thrown exception', async () => {
      try {
        await $original.zx`exit 1`;
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.exitCode).toBe(1);
        expect(error.stdout).toBeDefined();
        expect(error.stderr).toBeDefined();
      }
    });

    test('should support nothrow mode', async () => {
      const result = await $original.zx.nothrow`exit 1`;
      
      expect(result).toBeDefined();
      expect(result.exitCode).toBe(1);
      expect(result.code).toBe(1);
      // Should not throw
    });
  });

  describe('zx-compat Module', () => {
    test('should export zx-compatible $ function', async () => {
      expect($).toBeDefined();
      expect(typeof $).toBe('function');
      
      const result = await $`echo "test"`;
      expect(result.stdout).toContain('test');
    });

    test('should export cd function', () => {
      expect(cd).toBeDefined();
      expect(typeof cd).toBe('function');
    });

    test('should export echo function', () => {
      expect(echo).toBeDefined();
      expect(typeof echo).toBe('function');
    });

    test('should export standard modules', () => {
      expect(fs).toBeDefined();
      expect(path).toBeDefined();
      expect(os).toBeDefined();
    });
  });

  describe('cd Function', () => {
    test('should change directory', () => {
      const originalDir = process.cwd();
      
      cd('..');
      expect(process.cwd()).not.toBe(originalDir);
      
      // Restore
      cd(originalDir);
      expect(process.cwd()).toBe(originalDir);
    });

    test('should go to home directory when no argument', () => {
      cd();
      expect(process.cwd()).toBe(os.homedir());
    });

    test('should throw on non-existent directory', () => {
      expect(() => cd('/non/existent/path')).toThrow('No such file or directory');
    });

    test('should throw when target is not a directory', () => {
      // Try to cd to a file that definitely exists (use absolute path)
      const packagePath = path.resolve(process.cwd(), 'package.json');
      expect(() => cd(packagePath)).toThrow('Not a directory');
    });
  });

  describe('echo Function', () => {
    test('should be async and log message', async () => {
      // Mock console.log to capture output
      const originalLog = console.log;
      let captured = '';
      console.log = (msg) => { captured = msg; };
      
      try {
        await echo('test message');
        expect(captured).toBe('test message');
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('Options Support', () => {
    test('should support options object syntax', async () => {
      const result = await $original.zx({ timeout: 5000 })`echo "with options"`;
      
      expect(result.stdout).toContain('with options');
      expect(result.exitCode).toBe(0);
    });

    test('should support nothrow options', async () => {
      const result = await $original.zx.nothrow({ timeout: 5000 })`exit 1`;
      
      expect(result.exitCode).toBe(1);
      // Should not throw
    });
  });

  describe('Comparison with Original $', () => {
    test('zx mode should buffer output vs streaming mode', async () => {
      // Original $ returns ProcessRunner
      const originalResult = $original`echo "test"`;
      expect(originalResult).toBeDefined();
      expect(typeof originalResult.on).toBe('function'); // EventEmitter
      
      // zx mode returns buffered result
      const zxResult = await $original.zx`echo "test"`;
      expect(zxResult.stdout).toBeDefined();
      expect(zxResult.exitCode).toBeDefined();
      expect(typeof zxResult.on).toBe('undefined'); // Not EventEmitter
    });
  });

  describe('Real-world zx Script Patterns', () => {
    test('should handle typical shell script patterns', async () => {
      // Multi-line commands
      const result1 = await $`echo "line1"`;
      const result2 = await $`echo "line2"`;
      
      expect(result1.stdout.trim()).toBe('line1');
      expect(result2.stdout.trim()).toBe('line2');
    });

    test('should handle piping patterns', async () => {
      const result = await $`echo "hello world" | grep "world"`;
      expect(result.stdout).toContain('world');
    });

    test('should handle environment variables', async () => {
      const testVar = 'TEST_VALUE';
      const result = await $`echo "${testVar}"`;
      expect(result.stdout).toContain('TEST_VALUE');
    });
  });
});