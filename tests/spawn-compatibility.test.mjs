import { test, expect } from 'bun:test';
import $ from '../src/$.mjs';

test('spawn compatibility', () => {
  test('$.spawn should exist', () => {
    expect(typeof $.spawn).toBe('function');
  });

  test('$.spawn.sync should exist', () => {
    expect(typeof $.spawn.sync).toBe('function');
  });

  test('spawn.sync should execute simple commands', () => {
    const result = $.spawn.sync('echo', ['hello world'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.stderr).toBe('');
  });

  test('spawn.sync should handle errors gracefully', () => {
    const result = $.spawn.sync('nonexistent-command-xyz', [], { stdio: 'pipe' });
    expect(result.error).toBeTruthy();
    expect(result.status).toBeNull();
  });

  test('spawn.sync should return cross-spawn compatible format', () => {
    const result = $.spawn.sync('echo', ['test'], { encoding: 'utf8' });
    
    // Check all required cross-spawn properties exist
    expect(result).toHaveProperty('pid');
    expect(result).toHaveProperty('output');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('error');
    
    // Check types
    expect(typeof result.pid).toBe('number');
    expect(Array.isArray(result.output)).toBe(true);
    expect(result.output.length).toBe(3);
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
    expect(typeof result.status).toBe('number');
    expect(result.signal === null || typeof result.signal === 'string').toBe(true);
    expect(result.error === null || result.error instanceof Error).toBe(true);
  });

  test('spawn.sync should mirror output when stdio: "inherit"', () => {
    // This test just verifies it doesn't crash with inherit stdio
    const result = $.spawn.sync('echo', ['inherit test'], { stdio: 'inherit' });
    expect(result.status).toBe(0);
  });

  test('spawn.sync should handle different encodings', () => {
    const result = $.spawn.sync('echo', ['encoding test'], { encoding: 'utf8' });
    expect(typeof result.stdout).toBe('string');
    expect(result.stdout.trim()).toBe('encoding test');
  });
});