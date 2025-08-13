import { test, expect, describe, beforeEach } from 'bun:test';
import { $, shell } from '../$.mjs';

// Reset shell settings before each test
beforeEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
});

describe('Synchronous Execution (.sync())', () => {
  describe('Basic Sync Functionality', () => {
    test('should execute commands synchronously', () => {
      const result = $`echo "hello sync"`.sync();
      
      expect(result.stdout.trim()).toBe('hello sync');
      expect(result.code).toBe(0);
      expect(typeof result.stdout).toBe('string');
      expect(typeof result.stderr).toBe('string');
    });

    test('should handle stderr in sync mode', () => {
      const result = $`sh -c "echo 'stdout'; echo 'stderr' >&2"`.sync();
      
      expect(result.stdout.trim()).toBe('stdout');
      expect(result.stderr.trim()).toBe('stderr');
      expect(result.code).toBe(0);
    });

    test('should handle non-zero exit codes', () => {
      const result = $`exit 42`.sync();
      
      expect(result.code).toBe(42);
    });

    test('should handle command not found', () => {
      const result = $`nonexistent-command-99999`.sync();
      
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('not found');
    });
  });

  describe('Events in Sync Mode', () => {
    test('should emit batched events after completion', () => {
      const events = [];
      const cmd = $`echo "sync output"`;
      
      cmd.on('data', chunk => events.push(`data-${chunk.type}`));
      cmd.on('stdout', () => events.push('stdout'));
      cmd.on('stderr', () => events.push('stderr'));
      cmd.on('end', () => events.push('end'));
      cmd.on('exit', code => events.push(`exit-${code}`));
      
      const result = cmd.sync();
      
      // Events should be emitted after sync completes
      expect(events).toContain('data-stdout');
      expect(events).toContain('stdout');
      expect(events).toContain('end');
      expect(events).toContain('exit-0');
      expect(result.stdout.trim()).toBe('sync output');
    });

    test('should emit stderr events in sync mode', () => {
      const events = [];
      const cmd = $`sh -c "echo 'error' >&2"`;
      
      cmd.on('stderr', () => events.push('stderr'));
      cmd.on('data', chunk => {
        if (chunk.type === 'stderr') events.push('data-stderr');
      });
      
      cmd.sync();
      
      expect(events).toContain('stderr');
      expect(events).toContain('data-stderr');
    });
  });

  describe('Options in Sync Mode', () => {
    test('should respect mirror option', () => {
      // mirror: true by default - output should appear in terminal
      const result1 = $`echo "mirrored"`.sync();
      expect(result1.stdout.trim()).toBe('mirrored');
      
      // mirror: false - no terminal output but still captured
      const cmd2 = $`echo "not mirrored"`;
      cmd2.options.mirror = false;
      const result2 = cmd2.sync();
      expect(result2.stdout.trim()).toBe('not mirrored');
    });

    test('should respect capture option', () => {
      const cmd = $`echo "test"`;
      cmd.options.capture = false;
      const result = cmd.sync();
      
      // capture option doesn't affect sync mode - always captures
      // This is different from async mode
      expect(result.stdout.trim()).toBe('test');
    });

    test('should handle stdin options', () => {
      const cmd1 = $`cat`;
      cmd1.options.stdin = 'custom input';
      const result1 = cmd1.sync();
      expect(result1.stdout.trim()).toBe('custom input');
      
      const cmd2 = $`cat`;
      cmd2.options.stdin = Buffer.from('buffer input');
      const result2 = cmd2.sync();
      expect(result2.stdout.trim()).toBe('buffer input');
      
      const cmd3 = $`echo "ignored"`;
      cmd3.options.stdin = 'ignore';
      const result3 = cmd3.sync();
      expect(result3.stdout.trim()).toBe('ignored');
    });

    test('should handle cwd option', () => {
      const cmd = $`pwd`;
      cmd.options.cwd = '/tmp';
      const result = cmd.sync();
      // macOS uses /private/tmp symlink
      expect(result.stdout.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
    });
  });

  describe('Shell Settings in Sync Mode', () => {
    test('should respect errexit setting', () => {
      shell.errexit(true);
      
      expect(() => {
        $`exit 1`.sync();
      }).toThrow('Command failed with exit code 1');
      
      shell.errexit(false);
      const result = $`exit 1`.sync();
      expect(result.code).toBe(1);
    });

    test('should respect verbose setting', () => {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));
      
      try {
        shell.verbose(true);
        $`echo "verbose test"`.sync();
        
        expect(logs.some(log => log.includes('echo "verbose test"'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test('should respect xtrace setting', () => {
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));
      
      try {
        shell.xtrace(true);
        $`echo "trace test"`.sync();
        
        expect(logs.some(log => log.startsWith('+ '))).toBe(true);
        expect(logs.some(log => log.includes('echo "trace test"'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('Error Handling', () => {
    test('should throw if command already started asynchronously', async () => {
      const cmd = $`echo "test"`;
      
      // Start async execution
      const promise = cmd.then();
      
      // Try to run sync - should throw
      expect(() => cmd.sync()).toThrow('Command already started');
      
      // Clean up
      await promise;
    });

    test('should include error details when errexit is enabled', () => {
      shell.errexit(true);
      
      try {
        $`sh -c "echo 'output'; echo 'error' >&2; exit 5"`.sync();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.code).toBe(5);
        expect(error.stdout).toContain('output');
        expect(error.stderr).toContain('error');
        expect(error.result).toBeDefined();
        expect(error.message).toContain('exit code 5');
      }
    });
  });

  describe('Complex Scenarios', () => {
    test('should handle multiline output', () => {
      const result = $`printf '%s\n%s\n%s' 'line1' 'line2' 'line3'`.sync();
      
      const lines = result.stdout.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('line1');
      expect(lines[1]).toBe('line2');
      expect(lines[2]).toBe('line3');
    });

    test('should handle large output', () => {
      // Use seq which is more portable than {1..1000} bash expansion
      const result = $`seq 1 1000`.sync();
      
      const lines = result.stdout.trim().split('\n');
      expect(lines.length).toBeGreaterThan(900); // Should be 1000 lines
      expect(lines[0]).toBe('1');
      expect(lines[999]).toBe('1000');
    });

    test('should handle commands with quotes and special characters', () => {
      const result = $`echo "It's a 'test' with \\"quotes\\""`.sync();
      
      expect(result.stdout).toContain("It's");
      expect(result.stdout).toContain("test");
      expect(result.stdout).toContain("quotes");
    });
  });

  describe('Comparison with Async', () => {
    test('should produce same result as async version', async () => {
      const command = 'echo "test"; echo "error" >&2; exit 0';
      
      // Sync version
      const syncResult = $`sh -c '${command}'`.sync();
      
      // Async version
      const asyncResult = await $`sh -c '${command}'`;
      
      expect(syncResult.stdout).toBe(asyncResult.stdout);
      expect(syncResult.stderr).toBe(asyncResult.stderr);
      expect(syncResult.code).toBe(asyncResult.code);
    });

    test('should handle events differently than async', async () => {
      const syncEvents = [];
      const asyncEvents = [];
      
      // Sync version - events after completion
      const syncCmd = $`echo "test"`;
      syncCmd.on('data', () => syncEvents.push(Date.now()));
      const syncStart = Date.now();
      syncCmd.sync();
      const syncEnd = Date.now();
      
      // Async version - events during execution
      const asyncCmd = $`echo "test"`;
      asyncCmd.on('data', () => asyncEvents.push(Date.now()));
      const asyncStart = Date.now();
      await asyncCmd;
      const asyncEnd = Date.now();
      
      // Both should have events
      expect(syncEvents.length).toBeGreaterThan(0);
      expect(asyncEvents.length).toBeGreaterThan(0);
      
      // Sync events should all be after command completion
      syncEvents.forEach(time => {
        expect(time).toBeGreaterThanOrEqual(syncEnd - 10); // Allow small margin
      });
    });
  });
});