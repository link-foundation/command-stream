import { test, expect, describe, beforeEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, shell, set, unset } from '../src/$.mjs';

describe('Shell Settings (set -e / set +e equivalent)', () => {
  beforeEach(() => {
    // Reset all shell settings before each test
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
  });

  describe('Error Handling (set -e / set +e)', () => {
    test('should continue execution by default (like bash without set -e)', async () => {
      const result1 = await $`exit 1`;
      expect(result1.code).toBe(1);

      const result2 = await $`echo "continued"`;
      expect(result2.code).toBe(0);
      expect(result2.stdout.trim()).toBe('continued');
    });

    test('should throw on error when errexit enabled (set -e)', async () => {
      shell.errexit(true);

      try {
        await $`exit 42`;
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.code).toBe(42);
        expect(error.message).toContain('Command failed with exit code 42');
        expect(error.result).toBeDefined();
        expect(error.result.code).toBe(42);
      }
    });

    test('should stop throwing when errexit disabled (set +e)', async () => {
      shell.errexit(true);
      shell.errexit(false);

      const result = await $`exit 1`;
      expect(result.code).toBe(1);
      // Should not throw
    });

    test('should allow mid-script changes (like bash)', async () => {
      // Start without errexit
      const result1 = await $`exit 1`;
      expect(result1.code).toBe(1);

      // Enable errexit
      shell.errexit(true);
      try {
        await $`exit 2`;
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.code).toBe(2);
      }

      // Disable errexit again
      shell.errexit(false);
      const result3 = await $`exit 3`;
      expect(result3.code).toBe(3);
      // Should not throw
    });
  });

  describe('Verbose Mode (set -v)', () => {
    test('should not print commands by default', async () => {
      // Capture console output
      const originalLog = console.log;
      const capturedLogs = [];
      console.log = (...args) => capturedLogs.push(args.join(' '));

      try {
        await $`echo "silent"`;
        expect(capturedLogs).toHaveLength(0);
      } finally {
        console.log = originalLog;
      }
    });

    test('should print commands when verbose enabled', async () => {
      // Ensure clean state before intercepting console.log
      shell.errexit(false);
      shell.verbose(false);
      shell.xtrace(false);
      shell.pipefail(false);
      shell.nounset(false);

      const originalLog = console.log;
      const capturedLogs = [];
      console.log = (...args) => capturedLogs.push(args.join(' '));

      try {
        shell.verbose(true);
        await $`echo "verbose test"`;

        expect(capturedLogs.length).toBeGreaterThan(0);
        expect(
          capturedLogs.some((log) => log.includes('echo "verbose test"'))
        ).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('Trace Mode (set -x)', () => {
    test('should not trace commands by default', async () => {
      const originalLog = console.log;
      const capturedLogs = [];
      console.log = (...args) => capturedLogs.push(args.join(' '));

      try {
        await $`echo "no trace"`;
        expect(capturedLogs).toHaveLength(0);
      } finally {
        console.log = originalLog;
      }
    });

    test('should trace commands when xtrace enabled', async () => {
      // Ensure clean state before intercepting console.log
      shell.errexit(false);
      shell.verbose(false);
      shell.xtrace(false);
      shell.pipefail(false);
      shell.nounset(false);

      const originalLog = console.log;
      const capturedLogs = [];
      console.log = (...args) => capturedLogs.push(args.join(' '));

      try {
        shell.xtrace(true);
        await $`echo "trace test"`;

        expect(capturedLogs.length).toBeGreaterThan(0);
        expect(capturedLogs.some((log) => log.startsWith('+ '))).toBe(true);
        expect(
          capturedLogs.some((log) => log.includes('echo "trace test"'))
        ).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('Settings API', () => {
    test('should allow setting options with set() function', () => {
      set('e');
      expect(shell.settings().errexit).toBe(true);

      set('v');
      expect(shell.settings().verbose).toBe(true);

      set('x');
      expect(shell.settings().xtrace).toBe(true);
    });

    test('should allow unsetting options with unset() function', () => {
      shell.errexit(true);
      shell.verbose(true);

      unset('e');
      expect(shell.settings().errexit).toBe(false);

      unset('v');
      expect(shell.settings().verbose).toBe(false);
    });

    test('should support long option names', () => {
      set('errexit');
      expect(shell.settings().errexit).toBe(true);

      set('verbose');
      expect(shell.settings().verbose).toBe(true);

      unset('errexit');
      expect(shell.settings().errexit).toBe(false);
    });

    test('should return current settings', () => {
      shell.errexit(true);
      shell.verbose(true);

      const settings = shell.settings();
      expect(settings.errexit).toBe(true);
      expect(settings.verbose).toBe(true);
      expect(settings.xtrace).toBe(false);
      expect(settings.pipefail).toBe(false);
      expect(settings.nounset).toBe(false);
    });
  });

  describe('Shell Replacement Benefits', () => {
    test('should provide better error objects than bash', async () => {
      shell.errexit(true);

      try {
        await $`sh -c "echo 'stdout'; echo 'stderr' >&2; exit 5"`;
        expect(true).toBe(false);
      } catch (error) {
        expect(error.code).toBe(5);
        expect(error.stdout).toContain('stdout');
        expect(error.stderr).toContain('stderr');
        expect(error.result).toBeDefined();
        expect(error.result.code).toBe(5);
      }
    });

    test('should allow JavaScript control flow with shell semantics', async () => {
      const results = [];

      // Test a list of commands with error handling
      const commands = [
        'echo "success1"',
        'exit 1', // This will fail
        'echo "success2"',
      ];

      for (const cmd of commands) {
        try {
          shell.errexit(true);
          const result = await $`sh -c ${cmd}`;
          results.push({ cmd, success: true, output: result.stdout.trim() });
        } catch (error) {
          results.push({ cmd, success: false, code: error.code });

          // Decide whether to continue or not
          if (error.code === 1) {
            shell.errexit(false); // Continue on this specific error
          }
        }
      }

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[0].output).toBe('success1');
      expect(results[1].success).toBe(false);
      expect(results[1].code).toBe(1);
      expect(results[2].success).toBe(true);
      expect(results[2].output).toBe('success2');
    });
  });

  describe('Real-world Shell Script Pattern', () => {
    test('should support common shell script patterns', async () => {
      // Typical shell script pattern:
      // set -e  # exit on error
      // optional commands with set +e
      // set -e  # back to strict mode

      shell.errexit(true);

      // Critical setup command
      const setup = await $`echo "setup complete"`;
      expect(setup.code).toBe(0);

      // Optional command that might fail
      shell.errexit(false);
      const optional = await $`ls /nonexistent 2>/dev/null`;
      expect(optional.code).not.toBe(0); // Should fail but not throw

      // Back to strict mode for critical operations
      shell.errexit(true);
      const critical = await $`echo "critical operation"`;
      expect(critical.code).toBe(0);
      expect(critical.stdout.trim()).toBe('critical operation');
    });
  });
});
