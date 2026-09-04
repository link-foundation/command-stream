import { $ } from '../src/$.mjs';
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';

describe('Interactive Option Tests', () => {
  beforeEach(beforeTestCleanup);
  afterEach(afterTestCleanup);

  test('interactive option - default behavior', async () => {
    // Test that interactive is false by default
    const $custom = $({ capture: true, mirror: false });
    const cmd = $custom`echo test`;

    // Interactive should be false by default
    expect(cmd.options.interactive).toBe(false);
  });

  test('interactive option - explicit true', async () => {
    // Test that interactive can be set to true
    const $custom = $({ capture: true, mirror: false, interactive: true });
    const cmd = $custom`echo test`;

    // Interactive should be true when explicitly set
    expect(cmd.options.interactive).toBe(true);
  });

  test('interactive option - explicit false', async () => {
    // Test that interactive can be explicitly set to false
    const $custom = $({ capture: true, mirror: false, interactive: false });
    const cmd = $custom`echo test`;

    // Interactive should be false when explicitly set
    expect(cmd.options.interactive).toBe(false);
  });

  test('interactive option - passed through options merge', async () => {
    // Test that interactive option is preserved when merging options
    const $base = $({ capture: true, mirror: false });
    const cmd = $base`echo test`;

    // Start with different options to test merging
    cmd.start({ interactive: true });

    // Interactive should be true after options merge
    expect(cmd.options.interactive).toBe(true);
  });

  test('interactive option - does not affect command execution with pipes/capture', async () => {
    // Test that setting interactive: true doesn't interfere with normal command execution
    // when pipes are used (which prevents TTY forwarding anyway)
    const $interactive = $({ capture: true, mirror: false, interactive: true });
    const result = await $interactive`echo "interactive test"`;

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('interactive test');
  });

  test('interactive option - behavior with stdin inherit but no TTY', async () => {
    // Test that interactive mode requires both interactive:true AND TTY conditions
    // This test verifies the logic but won't actually use TTY in test environment
    const $interactive = $({
      capture: false,
      mirror: false,
      interactive: true,
      stdin: 'inherit',
    });
    const cmd = $interactive`echo "tty test"`;

    // Should still work even if TTY conditions aren't met
    expect(cmd.options.interactive).toBe(true);
    expect(cmd.options.stdin).toBe('inherit');
  });

  test('interactive option - works with template literal syntax', async () => {
    // Test interactive option with various template literal syntaxes
    const name = 'world';
    const $interactive = $({ capture: true, mirror: false, interactive: true });
    const cmd = $interactive`echo "hello ${name}"`;
    const result = await cmd;

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello world'); // Safe string 'world' doesn't need quotes
    expect(cmd.options.interactive).toBe(true); // Check the command object, not the result
  });

  test('interactive option - preserved in command chaining', async () => {
    // Test that interactive option is preserved through command operations
    const $interactive = $({ capture: true, mirror: false, interactive: true });
    const cmd1 = $interactive`echo "first"`;
    const cmd2 = cmd1.pipe($interactive`tr 'a-z' 'A-Z'`);

    // Both commands should preserve the interactive setting
    expect(cmd1.options.interactive).toBe(true);
    // Note: cmd2 (piped command) might have different options, that's expected
  });

  test('interactive option - type checking', async () => {
    // Test that interactive option accepts boolean values properly
    const $true = $({ interactive: true, capture: true, mirror: false });
    const $false = $({ interactive: false, capture: true, mirror: false });
    const $default = $({ capture: true, mirror: false });

    expect($true`echo test`.options.interactive).toBe(true);
    expect($false`echo test`.options.interactive).toBe(false);
    expect($default`echo test`.options.interactive).toBe(false);

    // Test with non-boolean values (should still work, JavaScript is flexible)
    const $truthy = $({ interactive: 1, capture: true, mirror: false });
    const $falsy = $({ interactive: 0, capture: true, mirror: false });

    expect(Boolean($truthy`echo test`.options.interactive)).toBe(true);
    expect(Boolean($falsy`echo test`.options.interactive)).toBe(false);
  });
});
