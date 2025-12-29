#!/usr/bin/env node

import { describe, it, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../js/src/$.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calcPath = path.join(__dirname, '../examples/interactive-math-calc.mjs');

describe('Interactive Streaming', () => {
  it('should support bidirectional streaming I/O while process is running', async () => {
    // Start the interactive math calculator
    const calc = $`node ${calcPath}`;

    // Get the streams immediately (process auto-starts)
    let stdin, stdout, stderr;
    try {
      stdin = await calc.streams.stdin;
      stdout = await calc.streams.stdout;
      stderr = await calc.streams.stderr;
    } catch (e) {
      console.error(`[interactive-streaming test] Error getting streams:`, e);
      throw e;
    }

    // Verify streams are available
    expect(stdin).toBeTruthy();
    expect(stdout).toBeTruthy();
    expect(stderr).toBeTruthy();

    // Set up stdout reader
    const results = [];
    let buffer = '';

    stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          results.push(line.trim());
        }
      }
    });

    // Wait for calculator to be ready
    await new Promise((resolve) => {
      const checkReady = () => {
        if (results.some((r) => r.includes('READY'))) {
          resolve();
        } else {
          setTimeout(checkReady, 10);
        }
      };
      checkReady();
    });

    expect(results).toContain('READY');

    // Test multiple math expressions
    const testCases = [
      { input: '1+2', expected: 'RESULT: 3' },
      { input: '10*5', expected: 'RESULT: 50' },
      { input: '100/4', expected: 'RESULT: 25' },
      { input: '7-3', expected: 'RESULT: 4' },
      { input: '2**8', expected: 'RESULT: 256' },
    ];

    for (const testCase of testCases) {
      const beforeCount = results.length;

      // Send expression
      stdin.write(`${testCase.input}\n`);

      // Wait for result
      await new Promise((resolve) => {
        const checkResult = () => {
          if (results.length > beforeCount) {
            resolve();
          } else {
            setTimeout(checkResult, 10);
          }
        };
        setTimeout(checkResult, 10);
      });

      // Verify result
      expect(results).toContain(testCase.expected);
    }

    // Send exit command
    stdin.write('exit\n');

    // Wait for goodbye message
    await new Promise((resolve) => {
      const checkGoodbye = () => {
        if (results.some((r) => r.includes('GOODBYE'))) {
          resolve();
        } else {
          setTimeout(checkGoodbye, 10);
        }
      };
      setTimeout(checkGoodbye, 10);
    });

    expect(results).toContain('GOODBYE');

    // Wait for process to complete
    const result = await calc;
    expect(result.code).toBe(0);

    // Verify we received all expected results
    const resultCount = results.filter((r) => r.includes('RESULT:')).length;
    expect(resultCount).toBe(testCases.length);
  }, 10000); // 10 second timeout

  it('should handle errors in expressions', async () => {
    const calc = $`node ${calcPath}`;

    const stdin = await calc.streams.stdin;
    const stdout = await calc.streams.stdout;
    const stderr = await calc.streams.stderr;

    expect(stdin).toBeTruthy();
    expect(stdout).toBeTruthy();
    expect(stderr).toBeTruthy();

    const results = [];
    const errors = [];
    let stdoutBuffer = '';
    let stderrBuffer = '';

    stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          results.push(line.trim());
        }
      }
    });

    stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          errors.push(line.trim());
        }
      }
    });

    // Wait for ready
    await new Promise((resolve) => {
      const check = () => {
        if (results.some((r) => r.includes('READY'))) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    // Send invalid expression
    stdin.write('invalid expression\n');

    // Wait for error
    await new Promise((resolve) => {
      const check = () => {
        if (errors.length > 0) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      setTimeout(check, 10);
    });

    expect(errors[0]).toContain('ERROR: Invalid expression');

    // Verify calculator still works after error
    stdin.write('5+5\n');

    const beforeCount = results.length;
    await new Promise((resolve) => {
      const check = () => {
        if (results.length > beforeCount) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      setTimeout(check, 10);
    });

    expect(results).toContain('RESULT: 10');

    // Exit
    stdin.write('exit\n');
    const result = await calc;
    expect(result.code).toBe(0);
  }, 10000);

  it('should auto-start process when accessing streams', async () => {
    const calc = $`node ${calcPath}`;

    // Process should not be started yet
    expect(calc.started).toBe(false);

    // Accessing streams should auto-start the process
    const stdin = await calc.streams.stdin;

    expect(calc.started).toBe(true);
    expect(stdin).toBeTruthy();

    // Clean up
    stdin.write('exit\n');
    await calc;
  });

  it('should return null for streams after process completes', async () => {
    const calc = $`node ${calcPath}`;

    const stdin = await calc.streams.stdin;
    stdin.write('exit\n');

    // Wait for process to complete
    await calc;

    // Streams should be null after completion
    const stdinAfter = await calc.streams.stdin;
    const stdoutAfter = await calc.streams.stdout;
    const stderrAfter = await calc.streams.stderr;

    expect(stdinAfter).toBeNull();
    expect(stdoutAfter).toBeNull();
    expect(stderrAfter).toBeNull();
  });

  it('should handle multiple simultaneous calculations', async () => {
    const calc = $`node ${calcPath}`;

    const stdin = await calc.streams.stdin;
    const stdout = await calc.streams.stdout;

    const results = [];
    let buffer = '';

    stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          results.push(line.trim());
        }
      }
    });

    // Wait for ready
    await new Promise((resolve) => {
      const check = () => {
        if (results.some((r) => r.includes('READY'))) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    // Send multiple calculations rapidly
    const expressions = ['1+1', '2+2', '3+3', '4+4', '5+5'];
    for (const expr of expressions) {
      stdin.write(`${expr}\n`);
    }

    // Wait for all results
    await new Promise((resolve) => {
      const check = () => {
        const resultCount = results.filter((r) => r.includes('RESULT:')).length;
        if (resultCount >= expressions.length) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      setTimeout(check, 10);
    });

    // Verify all results
    expect(results).toContain('RESULT: 2');
    expect(results).toContain('RESULT: 4');
    expect(results).toContain('RESULT: 6');
    expect(results).toContain('RESULT: 8');
    expect(results).toContain('RESULT: 10');

    stdin.write('exit\n');
    await calc;
  });
});
