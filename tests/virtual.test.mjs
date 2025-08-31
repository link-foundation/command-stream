import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { $, shell, register, unregister, listCommands, enableVirtualCommands } from '../src/$.mjs';

// Reset shell settings before each test
beforeEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
  // Enable virtual commands for these tests since they specifically test virtual commands
  enableVirtualCommands();
});

// Reset shell settings after each test to prevent interference with other test files
afterEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
});

describe('Virtual Commands System', () => {
  describe('Registration API', () => {
    test('should register and execute custom virtual command', async () => {
      register('greet', async ({ args }) => {
        const name = args[0] || 'World';
        return { stdout: `Hello, ${name}!\n`, code: 0 };
      });

      const result = await $`greet Alice`;
      
      expect(result.stdout).toBe('Hello, Alice!\n');
      expect(result.code).toBe(0);
      
      // Cleanup
      unregister('greet');
    });

    test('should unregister commands', async () => {
      register('temp', async () => ({ stdout: 'temp', code: 0 }));
      
      // Verify it exists
      expect(listCommands()).toContain('temp');
      
      // Unregister
      const removed = unregister('temp');
      expect(removed).toBe(true);
      expect(listCommands()).not.toContain('temp');
      
      // Verify it falls back to system command
      try {
        await $`temp`; // Should fail since 'temp' is not a system command
      } catch (error) {
        expect(error.code).not.toBe(0);
      }
    });

    test('should list registered commands', () => {
      const initialCommands = listCommands();
      
      register('test1', async () => ({ stdout: '', code: 0 }));
      register('test2', async () => ({ stdout: '', code: 0 }));
      
      const commands = listCommands();
      expect(commands).toContain('test1');
      expect(commands).toContain('test2');
      expect(commands.length).toBe(initialCommands.length + 2);
      
      // Cleanup
      unregister('test1');
      unregister('test2');
    });
  });

  describe('Built-in Commands', () => {
    test('should execute virtual cd command', async () => {
      const originalCwd = process.cwd();
      
      try {
        const result = await $`cd /tmp`;
        expect(result.code).toBe(0);
        expect(process.cwd()).not.toBe(originalCwd);
        expect(process.cwd()).toMatch(/tmp/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    test('should execute virtual pwd command', async () => {
      const result = await $`pwd`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(process.cwd());
    });

    test('should execute virtual echo command', async () => {
      const result = await $`echo Hello World`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Hello World\n');
    });

    test('should execute echo with -n flag', async () => {
      const result = await $`echo -n Hello`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Hello');
    });

    test('should execute virtual sleep command', async () => {
      const start = Date.now();
      const result = await $`sleep 0.1`;
      const elapsed = Date.now() - start;
      
      expect(result.code).toBe(0);
      expect(elapsed).toBeGreaterThan(90); // At least 90ms
      expect(elapsed).toBeLessThan(200); // But not too long
    });

    test('should execute virtual true command', async () => {
      const result = await $`true`;
      expect(result.code).toBe(0);
    });

    test('should execute virtual false command', async () => {
      const result = await $`false`;
      expect(result.code).toBe(1);
    });

    test('should execute virtual which command', async () => {
      const result = await $`which echo`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('echo: shell builtin\n');
    });

    test('should execute virtual exit command', async () => {
      const result = await $`exit 0`;
      expect(result.code).toBe(0);
      
      const result2 = await $`exit 42`;
      expect(result2.code).toBe(42);
    });

    test('should execute virtual env command', async () => {
      const result = await $`env`;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('PATH=');
    });

    test('should execute virtual test command', async () => {
      // Test directory
      const result1 = await $`test -d .`;
      expect(result1.code).toBe(0);
      
      // Test file
      const result2 = await $`test -f package.json`;
      expect(result2.code).toBe(0);
      
      // Test non-existent
      const result3 = await $`test -f nonexistent-file-99999`;
      expect(result3.code).toBe(1);
    });
  });

  describe('Virtual vs System Commands', () => {
    test('should prioritize virtual commands over system commands', async () => {
      // Register a virtual 'ls' that overrides system ls
      register('ls', async ({ args }) => {
        return { stdout: 'virtual ls output\n', code: 0 };
      });

      const result = await $`ls`;
      expect(result.stdout).toBe('virtual ls output\n');
      
      // Cleanup - should fall back to system ls
      unregister('ls');
      
      const systemResult = await $`ls`;
      expect(systemResult.stdout).not.toBe('virtual ls output\n');
      expect(systemResult.code).toBe(0); // System ls should work
    });

    test('should fall back to system commands when virtual not found', async () => {
      // This should use system echo (since we didn't override it... wait, we did!)
      // Let's test with a command we definitely didn't override
      const result = await $`date`;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('202'); // Should contain year
    });
  });

  describe('Streaming Virtual Commands', () => {
    test('should support async generator virtual commands', async () => {
      register('count', async function* ({ args }) {
        const max = parseInt(args[0] || 3);
        for (let i = 1; i <= max; i++) {
          yield `${i}\n`;
          // Small delay to test streaming
          await new Promise(r => setTimeout(r, 10));
        }
      });

      const chunks = [];
      for await (const chunk of $`count 3`.stream()) {
        chunks.push(chunk.data.toString());
      }
      
      expect(chunks.length).toBeGreaterThan(0);
      const output = chunks.join('');
      expect(output).toBe('1\n2\n3\n');
      
      // Cleanup
      unregister('count');
    });

    test('should handle events with streaming virtual commands', async () => {
      register('stream-test', async function* ({ args }) {
        yield 'chunk1\n';
        yield 'chunk2\n';
      });

      const events = [];
      const result = await new Promise((resolve) => {
        const cmd = $`stream-test`;
        cmd.on('stdout', () => events.push('stdout'));
        cmd.on('data', (chunk) => events.push(`data-${chunk.type}`));
        cmd.on('end', resolve);
        cmd.then().catch(() => {}); // Start execution
      });

      expect(events.length).toBeGreaterThan(0);
      expect(events).toContain('stdout');
      expect(events).toContain('data-stdout');
      
      // Cleanup
      unregister('stream-test');
    });
  });

  describe('Error Handling', () => {
    test('should handle virtual command errors', async () => {
      register('fail', async ({ args }) => {
        throw new Error('Virtual command failed');
      });

      const result = await $`fail`;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Virtual command failed');
      
      // Cleanup
      unregister('fail');
    });

    test('should respect errexit setting with virtual commands', async () => {
      register('fail-code', async ({ args }) => {
        return { stdout: '', stderr: 'Failed', code: 42 };
      });

      shell.errexit(true);
      
      try {
        await $`fail-code`;
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.code).toBe(42);
      }
      
      shell.errexit(false);
      const result = await $`fail-code`;
      expect(result.code).toBe(42);
      
      // Cleanup
      unregister('fail-code');
    });
  });

  describe('Command Arguments and Stdin', () => {
    test('should pass arguments correctly to virtual commands', async () => {
      register('args-test', async ({ args }) => {
        return { stdout: `Args: [${args.join(', ')}]\n`, code: 0 };
      });

      const result = await $`args-test one "two three" four`;
      expect(result.stdout).toBe('Args: [one, two three, four]\n');
      
      // Cleanup
      unregister('args-test');
    });

    test('should pass stdin to virtual commands', async () => {
      register('stdin-test', async ({ args, stdin }) => {
        return { stdout: `Received: ${stdin}\n`, code: 0 };
      });

      const result = await $`echo "test input" | stdin-test`;
      expect(result.stdout).toBe('Received: test input\n\n');
      
      // Cleanup
      unregister('stdin-test');
    });
  });

  describe('Shell Settings Integration', () => {
    test('should respect verbose setting for virtual commands', async () => {
      register('verbose-test', async () => ({ stdout: 'output', code: 0 }));

      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));
      
      try {
        shell.verbose(true);
        await $`verbose-test arg1 arg2`;
        
        expect(logs.some(log => log.includes('verbose-test arg1 arg2'))).toBe(true);
      } finally {
        console.log = originalLog;
        unregister('verbose-test');
      }
    });

    test('should respect xtrace setting for virtual commands', async () => {
      register('trace-test', async () => ({ stdout: 'output', code: 0 }));

      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));
      
      try {
        shell.xtrace(true);
        await $`trace-test`;
        
        expect(logs.some(log => log.startsWith('+ trace-test'))).toBe(true);
      } finally {
        console.log = originalLog;
        unregister('trace-test');
      }
    });
  });
});