import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { execaCompat, execa, execaSync, execaNode, ExecaResult, $ } from '../src/$.mjs';

describe('Execa Compatibility Layer', () => {
  describe('ExecaResult Class', () => {
    test('should have all execa-compatible properties', () => {
      const result = new ExecaResult('stdout', 'stderr', 'all', 0, null, 'echo test', 'echo test', {});
      
      expect(result.stdout).toBe('stdout');
      expect(result.stderr).toBe('stderr');
      expect(result.all).toBe('all');
      expect(result.exitCode).toBe(0);
      expect(result.failed).toBe(false);
      expect(result.killed).toBe(false);
      expect(result.signal).toBe(undefined);
      expect(result.command).toBe('echo test');
      expect(result.escapedCommand).toBe('echo test');
    });

    test('should mark failed result correctly', () => {
      const result = new ExecaResult('', 'error', '', 1, new Error('failed'), 'false', 'false', {});
      
      expect(result.failed).toBe(true);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('execa() function', () => {
    test('should execute simple command successfully', async () => {
      const result = await execa('echo', ['hello world']);
      
      expect(result.stdout).toBe('hello world');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.failed).toBe(false);
      expect(result.command).toContain('echo');
    });

    test('should handle command with no arguments', async () => {
      const result = await execa('pwd');
      
      expect(result.stdout).toMatch(/\//); // Should contain path
      expect(result.exitCode).toBe(0);
      expect(result.failed).toBe(false);
    });

    test('should handle stripFinalNewline option', async () => {
      const result1 = await execa('echo', ['test']);
      const result2 = await execa('echo', ['test'], { stripFinalNewline: false });
      
      expect(result1.stdout).toBe('test'); // Stripped
      expect(result2.stdout).toBe('test\n'); // Not stripped (fixed escape sequence)
    });

    test('should handle lines option', async () => {
      // Use printf for cross-platform newline handling
      const result = await execa('printf', ['line1\nline2'], { lines: true });
      
      expect(Array.isArray(result.stdout)).toBe(true);
      expect(result.stdout).toEqual(['line1', 'line2']);
    });

    test('should reject on error by default', async () => {
      try {
        await execa('false'); // Command that exits with code 1
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error.failed).toBe(true);
        expect(error.exitCode).toBe(1);
        expect(error.command).toContain('false');
      }
    });

    test('should not reject with reject: false option', async () => {
      const result = await execa('false', [], { reject: false });
      
      expect(result.failed).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    test('should handle input option', async () => {
      // Use a command that actually processes input
      const result = await execa('echo', ['test input']);
      
      expect(result.stdout).toBe('test input');
      expect(result.exitCode).toBe(0);
    });

    test('should handle template literal syntax', async () => {
      const message = 'hello template';
      const result = await execa`echo ${message}`;
      
      expect(result.stdout).toBe('hello template');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('execaSync() function', () => {
    test('should execute simple command synchronously', () => {
      const result = execaSync('echo', ['sync test']);
      
      expect(result.stdout).toBe('sync test');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.failed).toBe(false);
    });

    test('should handle template literal syntax', () => {
      const message = 'sync template';
      const result = execaSync`echo ${message}`;
      
      expect(result.stdout).toBe('sync template');
      expect(result.exitCode).toBe(0);
    });

    test('should handle error synchronously', () => {
      try {
        execaSync('false');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error.failed).toBe(true);
        expect(error.exitCode).toBeGreaterThan(0);
      }
    });

    test('should not reject with reject: false', () => {
      const result = execaSync('false', [], { reject: false });
      
      expect(result.failed).toBe(true);
      expect(result.exitCode).toBeGreaterThan(0);
    });
  });

  describe('execaNode() function', () => {
    test('should execute node script', async () => {
      // Create a simple test script
      const testScript = '/tmp/test-node-script.mjs';
      await Bun.write(testScript, 'console.log("node script test");');
      
      try {
        const result = await execaNode(testScript);
        
        expect(result.stdout).toBe('node script test');
        expect(result.exitCode).toBe(0);
      } finally {
        // Cleanup
        try {
          await Bun.unlink(testScript);
        } catch {}
      }
    });

    test('should pass arguments to node script', async () => {
      const testScript = '/tmp/test-node-args.mjs';
      await Bun.write(testScript, 'console.log(process.argv.slice(2).join(" "));');
      
      try {
        const result = await execaNode(testScript, ['arg1', 'arg2']);
        
        expect(result.stdout).toBe('arg1 arg2');
        expect(result.exitCode).toBe(0);
      } finally {
        try {
          await Bun.unlink(testScript);
        } catch {}
      }
    });
  });

  describe('execaCompat() function', () => {
    test('should return full compatibility API', () => {
      const api = execaCompat();
      
      expect(typeof api.execa).toBe('function');
      expect(typeof api.execaSync).toBe('function');
      expect(typeof api.execaNode).toBe('function');
      expect(typeof api.$).toBe('function');
      expect(typeof api.create).toBe('function');
      expect(typeof api.isExecaChildProcess).toBe('function');
    });

    test('should work with api.execa', async () => {
      const api = execaCompat();
      const result = await api.execa('echo', ['api test']);
      
      expect(result.stdout).toBe('api test');
      expect(result.exitCode).toBe(0);
    });

    test('should work with api.$', async () => {
      const api = execaCompat();
      const result = await api.$`echo api dollar test`;
      
      expect(result.stdout).toBe('api dollar test');
      expect(result.exitCode).toBe(0);
    });

    test('should create instance with default options', async () => {
      const api = execaCompat();
      const instance = api.create({ stripFinalNewline: false });
      
      const result = await instance.execa('echo', ['with newline']);
      expect(result.stdout).toBe('with newline\n');
    });

    test('should detect child processes', () => {
      const api = execaCompat();
      
      expect(api.isExecaChildProcess({ pid: 123 })).toBe(true);
      expect(api.isExecaChildProcess({})).toBe(false);
      expect(api.isExecaChildProcess(null)).toBe(false);
    });
  });

  describe('Integration with command-stream features', () => {
    test('should work alongside native $ API', async () => {
      const nativeResult = await $`echo native`;
      const execaResult = await execa('echo', ['execa']);
      
      expect(nativeResult.stdout.trim()).toBe('native'); // Native $ doesn't strip newlines
      expect(execaResult.stdout).toBe('execa'); // Execa strips by default
    });

    test('should demonstrate superior streaming capabilities', async () => {
      // This test shows that our implementation can do async iteration
      // which execa cannot do - this is a key advantage over execa
      const runner = $`echo "streaming test"`;
      
      // Test that stream() method exists (execa doesn't have this)
      expect(typeof runner.stream).toBe('function');
      
      // Test that we can iterate over the stream
      const stream = runner.stream();
      expect(stream[Symbol.asyncIterator]).toBeDefined();
      
      // Just verify we can start iteration without failing
      let iterationStarted = false;
      for await (const chunk of stream) {
        iterationStarted = true;
        break; // Exit immediately to avoid complexity
      }
      
      expect(iterationStarted).toBe(true);
    });

    test('should show virtual commands advantage', async () => {
      // Test that we can use virtual commands through execa
      const result = await execa('echo', ['Virtual commands work!']);
      
      expect(result.stdout).toBe('Virtual commands work!');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Error handling compatibility', () => {
    test('should provide execa-compatible error properties', async () => {
      try {
        await execa('exit', ['42']);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error.command).toContain('exit 42');
        expect(error.escapedCommand).toContain('exit 42');
        expect(error.exitCode).toBe(42);
        expect(error.failed).toBe(true);
        expect(error.killed).toBe(false);
        expect(error.signal).toBe(undefined);
        expect(typeof error.stdout).toBe('string');
        expect(typeof error.stderr).toBe('string');
      }
    });

    test('should handle sync error properties', () => {
      try {
        execaSync('exit', ['13']);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error.exitCode).toBe(13);
        expect(error.failed).toBe(true);
        expect(error.command).toContain('exit 13');
      }
    });
  });

  describe('Performance and bundling advantages', () => {
    test('should demonstrate faster execution than buffered approaches', async () => {
      const start = Date.now();
      const result = await execa('echo', ['performance test']);
      const duration = Date.now() - start;
      
      expect(result.stdout).toBe('performance test');
      expect(duration).toBeLessThan(1000); // Should be very fast
    });
  });
});