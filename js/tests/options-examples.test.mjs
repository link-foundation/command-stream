#!/usr/bin/env node

import { test, expect, describe } from 'bun:test';
import { isWindows } from './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';

describe('Options Examples (Feature Demo)', () => {
  test('example: disable capture for performance', async () => {
    // When you don't need the output stored in memory
    const result = await $`echo "performance optimization"`.start({
      capture: false,
    });

    // Output goes to console but not stored in result
    expect(result.stdout).toBeUndefined();
    expect(result.code).toBe(0);
  });

  test('example: disable mirroring for silent execution', async () => {
    // When you want to capture output but not show it on console
    const result = await $`echo "silent execution"`.start({ mirror: false });

    // Output is captured but not shown on console
    expect(result.stdout).toBe('silent execution\n');
    expect(result.code).toBe(0);
  });

  test('example: both disabled for maximum performance', async () => {
    // When you just want to run a command and check exit code
    const result = await $`echo "max performance"`.start({
      capture: false,
      mirror: false,
    });

    expect(result.stdout).toBeUndefined();
    expect(result.code).toBe(0);
  });

  test('example: custom stdin with options', async () => {
    // Pass custom input and configure output behavior
    const result = await $`cat`.start({
      stdin: 'Hello from stdin!',
      mirror: false, // Don't show on console
      capture: true, // But do capture the result
    });

    expect(result.stdout).toBe('Hello from stdin!');
    expect(result.code).toBe(0);
  });

  test('example: using .run() alias', async () => {
    // .run() works exactly like .start()
    const result1 = await $`echo "using run method"`.run({ capture: false });
    const result2 = await $`echo "using start method"`.start({
      capture: false,
    });

    expect(result1.stdout).toBeUndefined();
    expect(result2.stdout).toBeUndefined();
    expect(result1.code).toBe(0);
    expect(result2.code).toBe(0);
  });

  test('example: comparison with sh() function', async () => {
    // Before: had to use sh() function for options
    // const result = await sh('echo "with sh function"', { mirror: false });

    // Now: can use template literal syntax with options
    const result = await $`echo "with template literal"`.start({
      mirror: false,
    });

    expect(result.stdout).toBe('with template literal\n');
    expect(result.code).toBe(0);
  });

  // Skip on Windows - uses 'ls /tmp' which is Unix-specific
  test.skipIf(isWindows)(
    'example: real shell command vs virtual command',
    async () => {
      // Both work the same way
      const virtualResult = await $`echo "virtual command"`.start({
        capture: false,
      });
      const realResult = await $`ls /tmp`.start({ capture: false });

      expect(virtualResult.stdout).toBeUndefined();
      expect(realResult.stdout).toBeUndefined();
      expect(virtualResult.code).toBe(0);
      expect(realResult.code).toBe(0);
    }
  );

  test('example: chaining still works', async () => {
    // You can still use all other methods after .start() or .run()
    const runner = $`echo "chainable"`;
    const result = await runner.start({ mirror: false });

    expect(result.stdout).toBe('chainable\n');
    expect(result.code).toBe(0);

    // The result object has the standard properties
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('stdin');
  });
});
