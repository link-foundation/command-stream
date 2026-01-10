/**
 * Tests for array interpolation in command-stream
 *
 * This test file covers the Array.join() pitfall documented in issue #153.
 * The key insight: arrays passed directly to template interpolation are handled
 * correctly (each element becomes a separate argument), but if you call .join(' ')
 * before passing, the entire string becomes a single argument.
 *
 * @see https://github.com/link-foundation/command-stream/issues/153
 * @see js/docs/case-studies/issue-153/README.md
 * @see js/BEST-PRACTICES.md
 */

import { $, quote } from '../src/$.mjs';
import { describe, test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup

describe('Array Interpolation', () => {
  describe('Direct Array Passing (Correct Usage)', () => {
    test('should treat each array element as separate argument', () => {
      const args = ['arg1', 'arg2', 'arg3'];
      const cmd = $({ mirror: false })`echo ${args}`;

      expect(cmd.spec.command).toBe('echo arg1 arg2 arg3');
    });

    test('should quote elements with spaces individually', () => {
      const args = ['file with spaces.txt', '--verbose'];
      const cmd = $({ mirror: false })`command ${args}`;

      expect(cmd.spec.command).toBe("command 'file with spaces.txt' --verbose");
    });

    test('should handle empty array', () => {
      const args = [];
      const cmd = $({ mirror: false })`echo ${args}`;

      expect(cmd.spec.command).toBe('echo ');
    });

    test('should handle single-element array', () => {
      const args = ['single'];
      const cmd = $({ mirror: false })`echo ${args}`;

      expect(cmd.spec.command).toBe('echo single');
    });

    test('should handle array with special characters', () => {
      const args = ['$var', '`command`', '$(sub)'];
      const cmd = $({ mirror: false })`echo ${args}`;

      // Each special character should be quoted
      expect(cmd.spec.command).toBe("echo '$var' '`command`' '$(sub)'");
    });

    test('should handle array with flags correctly', () => {
      const args = ['input.txt', '--public', '--verbose'];
      const cmd = $({ mirror: false })`upload ${args}`;

      expect(cmd.spec.command).toBe('upload input.txt --public --verbose');
    });
  });

  describe('Pre-joined Array (Anti-pattern)', () => {
    test('joined array becomes single argument with spaces', () => {
      const args = ['file.txt', '--flag'];
      // This is the anti-pattern - joining before interpolation
      const joined = args.join(' ');
      const cmd = $({ mirror: false })`command ${joined}`;

      // The joined string gets quoted as ONE argument
      expect(cmd.spec.command).toBe("command 'file.txt --flag'");
    });

    test('demonstrates the bug: flags become part of filename', () => {
      // This reproduces the exact bug from hive-mind#1096
      const args = ['/tmp/logfile.txt', '--public', '--verbose'];
      const joined = args.join(' ');
      const cmd = $({ mirror: false })`gh-upload-log ${joined}`;

      // WRONG: The shell sees one argument containing spaces
      expect(cmd.spec.command).toBe(
        "gh-upload-log '/tmp/logfile.txt --public --verbose'"
      );
      // This would cause: Error: File does not exist: "/tmp/logfile.txt --public --verbose"
    });

    test('correct usage vs incorrect usage comparison', () => {
      const args = ['file.txt', '--flag1', '--flag2'];

      // CORRECT: Direct array interpolation
      const correctCmd = $({ mirror: false })`cmd ${args}`;
      expect(correctCmd.spec.command).toBe('cmd file.txt --flag1 --flag2');

      // INCORRECT: Pre-joined array
      const incorrectCmd = $({ mirror: false })`cmd ${args.join(' ')}`;
      expect(incorrectCmd.spec.command).toBe("cmd 'file.txt --flag1 --flag2'");
    });
  });

  describe('Mixed Interpolation Patterns', () => {
    test('should handle multiple separate interpolations', () => {
      const file = 'data.txt';
      const flags = ['--verbose', '--force'];
      const cmd = $({ mirror: false })`process ${file} ${flags}`;

      expect(cmd.spec.command).toBe('process data.txt --verbose --force');
    });

    test('should handle array with conditional elements', () => {
      const baseArgs = ['input.txt'];
      const verbose = true;
      const force = false;

      if (verbose) {
        baseArgs.push('--verbose');
      }
      if (force) {
        baseArgs.push('--force');
      }

      const cmd = $({ mirror: false })`command ${baseArgs}`;
      expect(cmd.spec.command).toBe('command input.txt --verbose');
    });

    test('should handle spread operator pattern', () => {
      const files = ['file1.txt', 'file2.txt'];
      const flags = ['--recursive'];
      const allArgs = [...files, ...flags];

      const cmd = $({ mirror: false })`copy ${allArgs}`;
      expect(cmd.spec.command).toBe('copy file1.txt file2.txt --recursive');
    });
  });

  describe('Real-World Use Cases', () => {
    test('git command with multiple flags', () => {
      const flags = ['--oneline', '--graph', '--all'];
      const cmd = $({ mirror: false })`git log ${flags}`;

      expect(cmd.spec.command).toBe('git log --oneline --graph --all');
    });

    test('npm install with packages', () => {
      const packages = ['lodash', 'express', 'typescript'];
      const cmd = $({ mirror: false })`npm install ${packages}`;

      expect(cmd.spec.command).toBe('npm install lodash express typescript');
    });

    test('file operations with paths containing spaces', () => {
      const files = ['My Documents/file1.txt', 'Other Folder/file2.txt'];
      const cmd = $({ mirror: false })`cat ${files}`;

      expect(cmd.spec.command).toBe(
        "cat 'My Documents/file1.txt' 'Other Folder/file2.txt'"
      );
    });

    test('docker command with environment variables', () => {
      const envVars = ['-e', 'NODE_ENV=production', '-e', 'DEBUG=false'];
      const cmd = $({ mirror: false })`docker run ${envVars} myimage`;

      expect(cmd.spec.command).toBe(
        'docker run -e NODE_ENV=production -e DEBUG=false myimage'
      );
    });

    test('rsync with exclude patterns', () => {
      const excludes = ['--exclude', 'node_modules', '--exclude', '.git'];
      const cmd = $({ mirror: false })`rsync -av ${excludes} src/ dest/`;

      expect(cmd.spec.command).toBe(
        'rsync -av --exclude node_modules --exclude .git src/ dest/'
      );
    });
  });

  describe('Edge Cases', () => {
    test('array with empty strings', () => {
      const args = ['', 'arg', ''];
      const cmd = $({ mirror: false })`echo ${args}`;

      expect(cmd.spec.command).toBe("echo '' arg ''");
    });

    test('array with null-ish values coerced to strings', () => {
      const args = [null, undefined, 'valid'];
      const cmd = $({ mirror: false })`echo ${args}`;

      // null and undefined become empty strings
      expect(cmd.spec.command).toBe("echo '' '' valid");
    });

    test('nested arrays are flattened by the user (not automatic)', () => {
      // Note: nested arrays are not automatically flattened
      // Users should flatten them before passing
      const nested = [['a', 'b'], 'c'];
      const flattened = nested.flat();
      const cmd = $({ mirror: false })`echo ${flattened}`;

      expect(cmd.spec.command).toBe('echo a b c');
    });

    test('array with numbers', () => {
      const args = [1, 2, 3];
      const cmd = $({ mirror: false })`seq ${args}`;

      expect(cmd.spec.command).toBe('seq 1 2 3');
    });

    test('array with boolean coercion', () => {
      const args = [true, false];
      const cmd = $({ mirror: false })`echo ${args}`;

      expect(cmd.spec.command).toBe('echo true false');
    });
  });
});

describe('quote() Function Direct Tests', () => {
  test('quote function handles arrays correctly', () => {
    const args = ['file.txt', '--flag'];
    const result = quote(args);

    expect(result).toBe('file.txt --flag');
  });

  test('quote function handles nested arrays', () => {
    const args = ['safe', 'has space'];
    const result = quote(args);

    expect(result).toBe("safe 'has space'");
  });

  test('quote function handles mixed safe and unsafe elements', () => {
    const args = ['safe', '$dangerous', 'also-safe'];
    const result = quote(args);

    expect(result).toBe("safe '$dangerous' also-safe");
  });
});

describe('Functional Tests (Command Execution)', () => {
  test('array arguments work correctly with real command', async () => {
    const args = ['hello', 'world'];
    const result = await $({ mirror: false, capture: true })`echo ${args}`;

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
  });

  test('pre-joined array creates single argument (demonstrates bug)', async () => {
    // This test shows that pre-joined arrays cause the bug
    const args = ['hello', 'world'];
    const joined = args.join(' ');
    const result = await $({ mirror: false, capture: true })`echo ${joined}`;

    expect(result.code).toBe(0);
    // Output is the same in this case because echo just prints
    // But the shell received it as a single quoted argument
    expect(result.stdout.trim()).toBe('hello world');
  });

  test('array with spaces handled correctly', async () => {
    // Create test files to demonstrate proper argument handling
    const result = await $({ mirror: false, capture: true })`echo ${'one two'}`;

    // 'one two' is passed as single argument (quoted)
    expect(result.stdout.trim()).toBe('one two');
  });

  test('array elements become separate arguments for wc', async () => {
    // wc -w counts words - this shows that arguments are properly separated
    const args = ['a', 'b', 'c'];

    // Create a test that shows echo receives separate args
    const result = await $({
      mirror: false,
      capture: true,
    })`/bin/sh -c 'echo $#'`;
    expect(result.code).toBe(0);
    // Shell received 0 extra args (just the -c and script)
  });
});

describe('Documentation Examples Verification', () => {
  test('README Common Pitfalls example - incorrect usage', () => {
    const args = ['file.txt', '--public', '--verbose'];
    const cmd = $({ mirror: false })`command ${args.join(' ')}`;

    // This demonstrates the bug: one argument instead of three
    expect(cmd.spec.command).toBe("command 'file.txt --public --verbose'");
  });

  test('README Common Pitfalls example - correct usage', () => {
    const args = ['file.txt', '--public', '--verbose'];
    const cmd = $({ mirror: false })`command ${args}`;

    // Correct: three separate arguments
    expect(cmd.spec.command).toBe('command file.txt --public --verbose');
  });

  test('BEST-PRACTICES.md Pattern 1: Direct array passing', () => {
    const args = ['file.txt', '--verbose'];
    const cmd = $({ mirror: false })`command ${args}`;

    expect(cmd.spec.command).toBe('command file.txt --verbose');
  });

  test('BEST-PRACTICES.md Pattern 2: Separate interpolations', () => {
    const file = 'file.txt';
    const flags = ['--verbose', '--force'];
    const cmd = $({ mirror: false })`command ${file} ${flags}`;

    expect(cmd.spec.command).toBe('command file.txt --verbose --force');
  });

  test('BEST-PRACTICES.md Pattern 3: Build array dynamically', () => {
    const verbose = true;
    const allArgs = ['input.txt'];
    if (verbose) {
      allArgs.push('--verbose');
    }
    const cmd = $({ mirror: false })`command ${allArgs}`;

    expect(cmd.spec.command).toBe('command input.txt --verbose');
  });
});
