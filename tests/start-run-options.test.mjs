#!/usr/bin/env node

import { test, expect, describe } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';

describe('Start/Run Options Passing', () => {
  describe('.start() method with options', () => {
    test('should pass capture: false option correctly', async () => {
      const result = await $`echo "test with capture false"`.start({
        capture: false,
      });
      expect(result.stdout).toBeUndefined();
      expect(result.code).toBe(0);
    });

    test('should pass capture: true option correctly', async () => {
      const result = await $`echo "test with capture true"`.start({
        capture: true,
      });
      expect(result.stdout).toBe('test with capture true\n');
      expect(result.code).toBe(0);
    });

    test('should pass mirror: false option correctly', async () => {
      // mirror: false should still capture but not show output to console
      const result = await $`echo "test with mirror false"`.start({
        mirror: false,
      });
      expect(result.stdout).toBe('test with mirror false\n');
      expect(result.code).toBe(0);
    });

    test('should pass both capture and mirror options', async () => {
      const result = await $`echo "test both options"`.start({
        capture: false,
        mirror: false,
      });
      expect(result.stdout).toBeUndefined();
      expect(result.code).toBe(0);
    });

    test('should pass stdin option correctly', async () => {
      const result = await $`cat`.start({
        stdin: 'custom input data',
        capture: true,
      });
      expect(result.stdout).toBe('custom input data');
      expect(result.code).toBe(0);
    });

    test('should work with real shell commands', async () => {
      const result = await $`ls /tmp`.start({ capture: false });
      expect(result.stdout).toBeUndefined();
      expect(result.code).toBe(0);
    });

    test('should ignore options if process already started', async () => {
      const runner = $`echo "already started test"`;

      // Start the process
      const firstResult = await runner.start();
      expect(firstResult.stdout).toBe('already started test\n');

      // Try to start again with different options - should be ignored
      const secondResult = await runner.start({ capture: false });
      expect(secondResult.stdout).toBe('already started test\n'); // Should still have stdout
    });
  });

  describe('.run() method (alias for .start())', () => {
    test('should work identically to .start() with capture: false', async () => {
      const result = await $`echo "test with run alias"`.run({
        capture: false,
      });
      expect(result.stdout).toBeUndefined();
      expect(result.code).toBe(0);
    });

    test('should work identically to .start() with capture: true', async () => {
      const result = await $`echo "test with run alias"`.run({ capture: true });
      expect(result.stdout).toBe('test with run alias\n');
      expect(result.code).toBe(0);
    });

    test('should work with multiple options', async () => {
      const result = await $`echo "run with multiple options"`.run({
        mirror: false,
        capture: true,
      });
      expect(result.stdout).toBe('run with multiple options\n');
      expect(result.code).toBe(0);
    });

    test('should work with stdin option', async () => {
      const result = await $`cat`.run({
        stdin: 'run method input',
        capture: true,
      });
      expect(result.stdout).toBe('run method input');
      expect(result.code).toBe(0);
    });
  });

  describe('Backward compatibility', () => {
    test('direct await should still work with default options', async () => {
      const result = await $`echo "default behavior"`;
      expect(result.stdout).toBe('default behavior\n');
      expect(result.code).toBe(0);
    });

    test('.start() without options should work identically to direct await', async () => {
      const directResult = await $`echo "no options test"`;
      const startResult = await $`echo "no options test"`.start();

      expect(directResult.stdout).toBe(startResult.stdout);
      expect(directResult.code).toBe(startResult.code);
    });

    test('.run() without options should work identically to direct await', async () => {
      const directResult = await $`echo "run no options"`;
      const runResult = await $`echo "run no options"`.run();

      expect(directResult.stdout).toBe(runResult.stdout);
      expect(directResult.code).toBe(runResult.code);
    });
  });

  describe('Virtual commands support', () => {
    test('should work with virtual echo command', async () => {
      const result = await $`echo "virtual command test"`.start({
        capture: false,
      });
      expect(result.stdout).toBeUndefined();
      expect(result.code).toBe(0);
    });

    test('should work with virtual commands using .run()', async () => {
      const result = await $`echo "virtual run test"`.run({
        capture: true,
        mirror: false,
      });
      expect(result.stdout).toBe('virtual run test\n');
      expect(result.code).toBe(0);
    });
  });

  describe('Edge cases', () => {
    test('should handle empty options object', async () => {
      const result = await $`echo "empty options"`.start({});
      expect(result.stdout).toBe('empty options\n');
      expect(result.code).toBe(0);
    });

    test('should handle mode option alongside other options', async () => {
      const result = await $`echo "with mode option"`.start({
        mode: 'async',
        capture: false,
      });
      expect(result.stdout).toBeUndefined();
      expect(result.code).toBe(0);
    });

    test('should reinitialize chunks when capture option changes', async () => {
      const runner = $`echo "chunk reinit test"`;

      // Verify initial state
      expect(runner.options.capture).toBe(true);
      expect(runner.outChunks).toEqual([]);

      // Change capture to false
      const result = await runner.start({ capture: false });

      // Verify chunks were reinitialized
      expect(runner.options.capture).toBe(false);
      expect(runner.outChunks).toBe(null);
      expect(result.stdout).toBeUndefined();
    });
  });
});
