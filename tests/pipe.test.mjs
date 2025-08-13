import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { $, register, unregister, enableVirtualCommands, disableVirtualCommands } from '../$.mjs';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Test directory for safe file operations
const TEST_DIR = 'test-pipe';

beforeEach(() => {
  // Enable virtual commands for these tests
  enableVirtualCommands();
  
  // Create clean test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR);
});

afterEach(() => {
  // Clean up test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('Programmatic .pipe() Method', () => {
  describe('Basic Piping', () => {
    test('should pipe between built-in commands', async () => {
      register('add-prefix', async (args, stdin) => {
        const prefix = args[0] || 'PREFIX:';
        return { stdout: `${prefix} ${stdin.trim()}\n`, code: 0 };
      });

      const result = await $`echo "Hello World"`.pipe($`add-prefix "Piped:"`);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Piped: Hello World\n');
      
      // Cleanup
      unregister('add-prefix');
    });

    test('should pipe virtual commands', async () => {
      register('double', async (args, stdin) => {
        const lines = stdin.split('\n').filter(Boolean);
        const doubled = lines.map(line => line + line).join('\n') + '\n';
        return { stdout: doubled, code: 0 };
      });

      register('count-chars', async (args, stdin) => {
        const charCount = stdin.replace(/\n/g, '').length;
        return { stdout: `${charCount}\n`, code: 0 };
      });

      const result = await $`echo "hello"`.pipe($`double`).pipe($`count-chars`);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('10\n'); // "hellohello" = 10 chars
      
      // Cleanup
      unregister('double');
      unregister('count-chars');
    });

    test('should handle stdin properly in pipe chain', async () => {
      register('prefix', async (args, stdin) => {
        const prefix = args[0] || 'PREFIX:';
        const lines = stdin.split('\n').filter(Boolean);
        const prefixed = lines.map(line => `${prefix} ${line}`).join('\n') + '\n';
        return { stdout: prefixed, code: 0 };
      });

      const result = await $`echo "test"`.pipe($`prefix "[PIPED]"`);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('[PIPED] test\n');
      
      // Cleanup
      unregister('prefix');
    });
  });

  describe('Error Handling', () => {
    test('should propagate errors from source command', async () => {
      const result = await $`cat nonexistent-file.txt`.pipe($`echo "Should not reach here"`);
      
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No such file or directory');
      expect(result.stdout).toBe(''); // Destination should not execute
    });

    test('should handle errors in destination command', async () => {
      register('fail', async (args, stdin) => {
        return { stdout: '', stderr: 'Virtual command failed', code: 42 };
      });

      const result = await $`echo "hello"`.pipe($`fail`);
      
      expect(result.code).toBe(42);
      expect(result.stderr).toContain('Virtual command failed');
      
      // Cleanup
      unregister('fail');
    });

    test('should handle exceptions in virtual commands', async () => {
      register('throw-error', async (args, stdin) => {
        throw new Error('Something went wrong');
      });

      const result = await $`echo "hello"`.pipe($`throw-error`);
      
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Something went wrong');
      
      // Cleanup
      unregister('throw-error');
    });
  });

  describe('Complex Pipelines', () => {
    test('should support multiple pipe operations', async () => {
      register('uppercase', async (args, stdin) => {
        return { stdout: stdin.toUpperCase(), code: 0 };
      });

      register('reverse', async (args, stdin) => {
        const reversed = stdin.split('').reverse().join('');
        return { stdout: reversed, code: 0 };
      });

      register('add-brackets', async (args, stdin) => {
        return { stdout: `[${stdin.trim()}]\n`, code: 0 };
      });

      const result = await $`echo "hello"`
        .pipe($`uppercase`)
        .pipe($`reverse`)
        .pipe($`add-brackets`);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('[OLLEH]\n');
      
      // Cleanup
      unregister('uppercase');
      unregister('reverse');
      unregister('add-brackets');
    });

    test('should preserve stderr from all commands', async () => {
      register('warn-and-pass', async (args, stdin) => {
        return { 
          stdout: stdin, 
          stderr: `Warning from ${args[0]}\n`, 
          code: 0 
        };
      });

      const result = await $`echo "data"`
        .pipe($`warn-and-pass cmd1`)
        .pipe($`warn-and-pass cmd2`);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('data\n');
      expect(result.stderr).toContain('Warning from cmd1');
      expect(result.stderr).toContain('Warning from cmd2');
      
      // Cleanup
      unregister('warn-and-pass');
    });
  });

  describe('Mixed Command Types', () => {
    test('should pipe from built-in to virtual command', async () => {
      const testFile = join(TEST_DIR, 'pipe-test.txt');
      writeFileSync(testFile, 'Line 1\nLine 2\nLine 3\n');

      register('count-lines', async (args, stdin) => {
        const lines = stdin.split('\n').filter(Boolean);
        return { stdout: `${lines.length}\n`, code: 0 };
      });

      const result = await $`cat ${testFile}`.pipe($`count-lines`);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('3\n');
      
      // Cleanup
      unregister('count-lines');
    });

    test('should pipe from virtual to built-in command', async () => {
      register('generate-sequence', async (args) => {
        const count = parseInt(args[0] || 3);
        const sequence = Array.from({ length: count }, (_, i) => i + 1).join('\n') + '\n';
        return { stdout: sequence, code: 0 };
      });

      register('capture-lines', async (args, stdin) => {
        const lines = stdin.split('\n').filter(Boolean);
        return { stdout: `Got ${lines.length} lines\n`, code: 0 };
      });

      const result = await $`generate-sequence 5`.pipe($`capture-lines`);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Got 5 lines\n');
      
      // Cleanup
      unregister('generate-sequence');
      unregister('capture-lines');
    });
  });

  describe('Performance and Memory', () => {
    test('should handle large data efficiently', async () => {
      register('generate-large', async (args) => {
        const lines = parseInt(args[0] || 1000);
        let output = '';
        for (let i = 1; i <= lines; i++) {
          output += `Line ${i}\n`;
        }
        return { stdout: output, code: 0 };
      });

      register('count-occurrences', async (args, stdin) => {
        const pattern = args[0] || 'Line';
        const matches = (stdin.match(new RegExp(pattern, 'g')) || []).length;
        return { stdout: `${matches}\n`, code: 0 };
      });

      const start = Date.now();
      const result = await $`generate-large 10000`.pipe($`count-occurrences Line`);
      const elapsed = Date.now() - start;
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('10000\n');
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
      
      // Cleanup
      unregister('generate-large');
      unregister('count-occurrences');
    });
  });

  describe('Compatibility with Shell Piping', () => {
    test('should work alongside shell pipe syntax', async () => {
      register('format-output', async (args, stdin) => {
        return { stdout: `Formatted: ${stdin.trim()}\n`, code: 0 };
      });

      register('simple-pipe', async (args, stdin) => {
        return { stdout: `${stdin.trim()} processed\n`, code: 0 };
      });

      // Test that programmatic .pipe() works after shell pipe operations
      const result = await $`echo "hello"`.pipe($`simple-pipe`).pipe($`format-output`);
      
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Formatted: hello processed\n');
      
      // Cleanup
      unregister('format-output');
      unregister('simple-pipe');
    });
  });
});