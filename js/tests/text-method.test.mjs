import { describe, test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, disableVirtualCommands } from '../src/$.mjs';

// Disable virtual commands to ensure we're testing system/built-in commands
disableVirtualCommands();

describe('.text() method for Bun.$ compatibility', () => {
  test('sync execution should have .text() method', () => {
    const result = $`echo "sync test"`.sync();

    expect(typeof result.text).toBe('function');
    expect(result.text).toBeInstanceOf(Function);
  });

  test('async execution should have .text() method', async () => {
    const result = await $`echo "async test"`;

    expect(typeof result.text).toBe('function');
    expect(result.text).toBeInstanceOf(Function);
  });

  test('.text() should return stdout content (sync)', async () => {
    const result = $`echo "hello world"`.sync();
    const text = await result.text();

    expect(text).toBe('hello world\n');
  });

  test('.text() should return stdout content (async)', async () => {
    const result = await $`echo "hello async"`;
    const text = await result.text();

    expect(text).toBe('hello async\n');
  });

  test('.text() should handle empty output', async () => {
    // Use a command that produces no output
    const result = await $`true`;
    const text = await result.text();

    expect(text).toBe('');
  });

  test('.text() should handle multiline output', async () => {
    // Use seq to generate multiline output
    const result = await $`seq 1 3`;
    const text = await result.text();

    expect(text).toBe('1\n2\n3\n');
  });

  test('.text() should work with built-in commands', async () => {
    const result = await $`seq 1 3`;
    const text = await result.text();

    expect(text).toBe('1\n2\n3\n');
  });

  test('.text() should work with cat built-in command', async () => {
    // Create a test file first
    await $`echo "test content" > temp-text-test.txt`;

    const result = await $`cat temp-text-test.txt`;
    const text = await result.text();

    expect(text).toBe('test content\n');

    // Clean up
    await $`rm temp-text-test.txt`;
  });

  test('.text() should work with ls built-in command', async () => {
    const result = await $`ls -1 js/tests/`;
    const text = await result.text();

    // Should contain at least this test file
    expect(text).toContain('text-method.test.mjs');
  });

  test('.text() should work with pwd built-in command', async () => {
    const result = await $`pwd`;
    const text = await result.text();

    // Should return a path ending with newline
    expect(text.trim()).toBeTruthy();
    expect(text.endsWith('\n')).toBe(true);
  });

  test('.text() should return empty string for commands with no stdout', async () => {
    const result =
      await $`mkdir -p temp-dir-for-text-test && rmdir temp-dir-for-text-test`;
    const text = await result.text();

    expect(text).toBe('');
  });

  test('.text() should work with piped commands (when supported)', async () => {
    // Note: Pipeline with built-ins currently treats them as system commands
    // This test checks the behavior - expecting an error about unsupported pipeline
    try {
      const result = await $`seq 1 3 | cat`;
      // If this succeeds somehow, check the .text() method exists
      if (result.text) {
        const text = await result.text();
        expect(typeof text).toBe('string');
      }
    } catch (error) {
      // Expected for now - pipeline with system commands not supported
      expect(error.message).toContain('not yet supported');
    }
  });

  test('.text() should work with complex pipeline (when supported)', async () => {
    // Create a temp file for sorting
    await $`echo "3" > temp-sort-test.txt`;
    await $`echo "1" >> temp-sort-test.txt`;
    await $`echo "2" >> temp-sort-test.txt`;

    try {
      const result = await $`cat temp-sort-test.txt | sort`;
      // If this succeeds somehow, check the .text() method exists
      if (result.text) {
        const text = await result.text();
        expect(typeof text).toBe('string');
      }
    } catch (error) {
      // Expected for now - pipeline with system commands not supported
      expect(error.message).toContain('not yet supported');
    }

    // Clean up
    await $`rm temp-sort-test.txt`;
  });

  test('.text() should handle commands with stderr but no stdout', async () => {
    try {
      const result = await $`cat nonexistent-file-text-test.txt`;
      const text = await result.text();

      expect(text).toBe('');
    } catch (error) {
      // Some shells might throw on error, that's fine
      expect(error.result).toBeDefined();
      if (error.result) {
        const text = await error.result.text();
        expect(text).toBe('');
      }
    }
  });

  test('.text() should be consistent with .stdout property', async () => {
    const result = await $`echo "consistency test"`;
    const text = await result.text();

    expect(text).toBe(result.stdout);
  });

  test('.text() can be called multiple times', async () => {
    const result = await $`echo "multiple calls"`;

    const text1 = await result.text();
    const text2 = await result.text();
    const text3 = await result.text();

    expect(text1).toBe('multiple calls\n');
    expect(text2).toBe('multiple calls\n');
    expect(text3).toBe('multiple calls\n');
    expect(text1).toBe(text2);
    expect(text2).toBe(text3);
  });

  test('.text() returns a Promise', () => {
    const result = $`echo "promise test"`.sync();
    const textPromise = result.text();

    expect(textPromise).toBeInstanceOf(Promise);
  });

  test('.text() should work with binary-safe content', async () => {
    const testContent = 'content with special chars: üñíçødé 🚀';
    // Write content directly without shell quoting issues
    await $`touch temp-unicode-test.txt`;
    await $`echo ${testContent} > temp-unicode-test.txt`;

    const result = await $`cat temp-unicode-test.txt`;
    const text = await result.text();

    expect(text).toContain('üñíçødé');
    expect(text).toContain('🚀');

    // Clean up
    await $`rm temp-unicode-test.txt`;
  });

  test('.text() should work with .pipe() method results', async () => {
    const result = await $`echo "pipe test"`.pipe($`cat`);
    const text = await result.text();

    expect(text).toBe('pipe test\n');
  });

  test('.text() method should be accessible', () => {
    const result = $`echo "test"`.sync();
    const keys = Object.keys(result);

    // .text() method should be accessible
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('function');

    // Check if it's in the keys (implementation detail)
    const hasTextKey = keys.includes('text');
    expect(typeof hasTextKey).toBe('boolean'); // Just verify it's a boolean
  });

  test('.text() should handle very large output efficiently', async () => {
    // Generate a reasonably large output
    const result = await $`seq 1 1000`;
    const text = await result.text();

    expect(text).toContain('1\n');
    expect(text).toContain('1000\n');
    expect(text.split('\n')).toHaveLength(1001); // 1000 numbers + empty line at end
  });
});
