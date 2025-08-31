import { describe, it, expect } from 'bun:test';
import { $ } from '../src/$.mjs';

describe('$({ options }) syntax', () => {
  it('should support $({ options }) syntax for custom options', async () => {
    // Test with stdin option
    const $withStdin = $({ stdin: 'test input\n' });
    const result1 = await $withStdin`cat`;
    expect(result1.stdout).toBe('test input\n');
    expect(result1.code).toBe(0);
  });

  it('should support capture and mirror options', async () => {
    // Test with capture: false
    const $noCapture = $({ capture: false });
    const result = await $noCapture`echo "test"`;
    expect(result.stdout).toBeUndefined();
    expect(result.code).toBe(0);
  });

  it('should support multiple options at once', async () => {
    // Test with multiple options
    const $custom = $({ 
      stdin: 'hello world',
      capture: true,
      mirror: false 
    });
    const result = await $custom`cat`;
    expect(result.stdout).toBe('hello world');
    expect(result.code).toBe(0);
  });

  it('should work with environment variables', async () => {
    // Test with custom environment
    const $withEnv = $({ 
      env: { ...process.env, TEST_VAR: 'custom_value' }
    });
    const result = await $withEnv`printenv TEST_VAR`;
    expect(result.stdout.trim()).toBe('custom_value');
  });

  it('should work with custom working directory', async () => {
    // Test with custom cwd
    const $withCwd = $({ cwd: '/tmp' });
    const result = await $withCwd`pwd`;
    expect(result.stdout.trim()).toBe('/tmp');
  });

  it('should be reusable for multiple commands', async () => {
    // Create a reusable $ with options
    const $silent = $({ mirror: false, capture: true });
    
    const result1 = await $silent`echo "first"`;
    expect(result1.stdout.trim()).toBe('first');
    
    const result2 = await $silent`echo "second"`;
    expect(result2.stdout.trim()).toBe('second');
    
    const result3 = await $silent`echo "third"`;
    expect(result3.stdout.trim()).toBe('third');
  });

  it('should work alongside regular $ usage', async () => {
    // Mix regular and options syntax
    const regular = await $`echo "regular"`;
    expect(regular.stdout.trim()).toBe('regular');
    
    const withOptions = await $({ mirror: false })`echo "with options"`;
    expect(withOptions.stdout.trim()).toBe('with options');
    
    const regular2 = await $`echo "regular again"`;
    expect(regular2.stdout.trim()).toBe('regular again');
  });

  it('should handle stdin as ignore', async () => {
    const $noStdin = $({ stdin: 'ignore' });
    const result = await $noStdin`echo "test"`;
    expect(result.stdout.trim()).toBe('test');
    expect(result.code).toBe(0);
  });

  it('should handle stdin as inherit (default)', async () => {
    const $inheritStdin = $({ stdin: 'inherit' });
    const result = await $inheritStdin`echo "test"`;
    expect(result.stdout.trim()).toBe('test');
    expect(result.code).toBe(0);
  });

  it('should work with interpolation', async () => {
    const name = 'World';
    const $custom = $({ capture: true, mirror: false });
    const result = await $custom`echo Hello, ${name}!`;
    expect(result.stdout.trim()).toBe("Hello, 'World'!"); // Shell quoting is applied to interpolations
  });

  it('should work with command chaining', async () => {
    const $silent = $({ mirror: false });
    const result = await $silent`echo "test" | tr 'a-z' 'A-Z'`;
    expect(result.stdout.trim()).toBe('TEST');
  });

  it('should handle errors with custom options', async () => {
    const $custom = $({ capture: true, mirror: false });
    const result = await $custom`ls /nonexistent-path-${Date.now()}`;
    expect(result.code).toBeGreaterThan(0);
    expect(result.stderr).toContain('No such file or directory');
  });
});