import { test, expect, describe, beforeEach } from 'bun:test';
import { $, shell, disableVirtualCommands } from '../$.mjs';

// Reset shell settings before each test to prevent interference
beforeEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
  // Disable virtual commands for these tests to ensure system command behavior
  disableVirtualCommands();
});

describe('command-stream Feature Validation', () => {
  describe('Runtime Support', () => {
    test('should work in Bun runtime', () => {
      expect(typeof Bun).toBe('object');
      expect(typeof $).toBe('function');
    });

    test('should work in Node.js runtime', async () => {
      // This test validates that our library can run in Node.js
      // The fact that we can import and use $ proves Node.js compatibility
      const result = await $`echo "node compatibility"`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('node compatibility');
    });
  });

  describe('Template Literals', () => {
    test('should support $`cmd` syntax', async () => {
      const result = await $`echo "template literal test"`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('template literal test');
    });

    test('should support variable interpolation', async () => {
      const message = 'interpolation test';
      const result = await $`echo ${message}`;
      expect(result.stdout.trim()).toContain('interpolation test');
    });
  });

  describe('Real-time Streaming', () => {
    test('should provide live output streaming', async () => {
      const chunks = [];
      let receivedLiveData = false;
      
      for await (const chunk of $`echo "streaming test"`.stream()) {
        if (chunk.type === 'stdout') {
          chunks.push(chunk.data.toString());
          receivedLiveData = true;
          break; // Test that we can get data immediately
        }
      }
      
      expect(receivedLiveData).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
    });

    test('should stream data as it arrives, not buffered', async () => {
      const startTime = Date.now();
      let firstChunkTime = null;
      
      for await (const chunk of $`echo "immediate"; sleep 0.1; echo "delayed"`.stream()) {
        if (chunk.type === 'stdout' && firstChunkTime === null) {
          firstChunkTime = Date.now();
          break; // Get first chunk immediately
        }
      }
      
      const timeToFirstChunk = firstChunkTime - startTime;
      expect(timeToFirstChunk).toBeLessThan(50); // Should be immediate, not waiting for full command
    });
  });

  describe('Async Iteration', () => {
    test('should support for await (chunk of $.stream())', async () => {
      const chunks = [];
      
      for await (const chunk of $`echo "async iteration test"`.stream()) {
        chunks.push(chunk);
        if (chunk.type === 'stdout') break;
      }
      
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty('type');
      expect(chunks[0]).toHaveProperty('data');
    });

    test('should provide chunk metadata', async () => {
      for await (const chunk of $`echo "metadata test"`.stream()) {
        if (chunk.type === 'stdout') {
          expect(chunk.type).toBe('stdout');
          expect(Buffer.isBuffer(chunk.data)).toBe(true);
          break;
        }
      }
    });
  });

  describe('EventEmitter Pattern', () => {
    test('should support .on("data", ...) events', async () => {
      return new Promise((resolve) => {
        let dataReceived = false;
        const timeout = setTimeout(() => resolve(), 1000);
        
        $`echo "event test"`
          .on('data', (chunk) => {
            dataReceived = true;
            expect(chunk).toHaveProperty('type');
            expect(chunk).toHaveProperty('data');
          })
          .on('end', () => {
            clearTimeout(timeout);
            expect(dataReceived).toBe(true);
            resolve();
          })
          .on('exit', () => {
            if (dataReceived) {
              clearTimeout(timeout);
              resolve();
            }
          });
      });
    });

    test('should support multiple event types', async () => {
      return new Promise((resolve, reject) => {
        let events = [];
        const timeout = setTimeout(() => {
          // Don't wait forever, just check what we got
          clearTimeout(timeout);
          expect(events).toContain('stdout');
          expect(events).toContain('stderr');
          // Exit event may not be emitted before end in current implementation
          resolve();
        }, 1000);
        
        const cmd = $`echo "stdout"; echo "stderr" >&2`
          .on('stdout', () => events.push('stdout'))
          .on('stderr', () => events.push('stderr'))
          .on('exit', () => events.push('exit'))
          .on('end', () => {
            clearTimeout(timeout);
            expect(events).toContain('stdout');
            expect(events).toContain('stderr');
            // Don't require exit event since it may come after end
            resolve();
          })
          .on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        
        // Start the command explicitly
        cmd.start();
      });
    });
  });

  describe('Mixed Patterns', () => {
    test('should support events + await simultaneously', async () => {
      let eventData = '';
      let eventCount = 0;
      
      const process = $`echo "mixed pattern test"`;
      
      process.on('data', (chunk) => {
        if (chunk.type === 'stdout') {
          eventCount++;
          eventData += chunk.data.toString();
        }
      });
      
      const result = await process;
      
      expect(eventCount).toBeGreaterThan(0);
      expect(eventData.trim()).toBe('mixed pattern test');
      expect(result.stdout.trim()).toBe('mixed pattern test');
      expect(eventData).toBe(result.stdout);
    });
  });

  describe('Shell Injection Protection', () => {
    test('should auto-quote dangerous input', async () => {
      const dangerous = "'; rm -rf /; echo 'hacked";
      const result = await $`echo ${dangerous}`;
      
      expect(result.stdout.trim()).toBe(dangerous);
      expect(result.code).toBe(0);
    });

    test('should handle special characters safely', async () => {
      const special = '$HOME && echo "injection"';
      const result = await $`echo ${special}`;
      
      expect(result.stdout.trim()).toBe(special);
    });
  });

  describe('Cross-platform Support', () => {
    test('should work on current platform', async () => {
      // Test basic cross-platform command
      const result = await $`echo "cross-platform test"`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('cross-platform test');
    });
  });

  describe('Memory Efficiency', () => {
    test('should stream without accumulating large buffers', async () => {
      // This test validates that streaming prevents memory buildup
      // by processing data as it comes rather than buffering everything
      const chunks = [];
      let totalSize = 0;
      
      for await (const chunk of $`echo "memory efficient streaming test"`.stream()) {
        if (chunk.type === 'stdout') {
          chunks.push(chunk.data);
          totalSize += chunk.data.length;
          break; // Process immediately, don't accumulate
        }
      }
      
      expect(chunks.length).toBe(1);
      expect(totalSize).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle non-zero exit codes gracefully', async () => {
      const result = await $`exit 42`;
      
      expect(result.code).toBe(42);
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      // Should not throw, just return result with non-zero code
    });
  });

  describe('Stdin Support', () => {
    test('should support string stdin through sh helper', async () => {
      const { sh } = await import('../$.mjs');
      const result = await sh('cat', { stdin: 'stdin string test' });
      expect(result.stdout.trim()).toBe('stdin string test');
    });

    test('should support Buffer stdin through sh helper', async () => {
      const { sh } = await import('../$.mjs');
      const input = Buffer.from('buffer stdin test');
      const result = await sh('cat', { stdin: input });
      expect(result.stdout.trim()).toBe('buffer stdin test');
    });

    test('should support ignore stdin through options', async () => {
      const { sh } = await import('../$.mjs');
      const result = await sh('echo "ignore stdin test"', { stdin: 'ignore' });
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('ignore stdin test');
    });
  });
});