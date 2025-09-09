import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, CommandBuilder, command } from '../src/$.mjs';

describe('Command Builder API', () => {
  test('basic command construction', () => {
    const cmd = $.command('echo', 'hello');
    expect(cmd).toBeInstanceOf(CommandBuilder);
    expect(cmd.cmd).toBe('echo');
    expect(cmd.args).toEqual(['hello']);
  });

  test('command with multiple arguments', () => {
    const cmd = $.command('cat', './some-file.txt', './another-file.txt');
    expect(cmd.args).toEqual(['./some-file.txt', './another-file.txt']);
  });

  test('argument escaping for shell safety', () => {
    const cmd = $.command('echo', "hello world", "file with spaces.txt");
    const builtCommand = cmd.buildCommand();
    expect(builtCommand).toBe("echo 'hello world' 'file with spaces.txt'");
  });

  test('argument escaping with single quotes', () => {
    const cmd = $.command('echo', "don't escape", "it's working");
    const builtCommand = cmd.buildCommand();
    expect(builtCommand).toBe("echo 'don'\\''t escape' 'it'\\''s working'");
  });

  test('fluent API with method chaining', () => {
    const cmd = $.command('echo', 'hello')
      .arg('world')
      .stdout('inherit')
      .capture(false);
    
    expect(cmd.args).toEqual(['hello', 'world']);
    expect(cmd.options.stdout).toBe('inherit');
    expect(cmd.options.capture).toBe(false);
  });

  test('pipe configuration as shown in issue example', () => {
    const cmd = $.command('cat', './some-file.txt').pipe(
      $.command.stdout('inherit'),
      $.command.exitCode
    );
    
    expect(cmd.options.stdout).toBe('inherit');
  });

  test('environment variable configuration', () => {
    const cmd = $.command('env')
      .env({ FOO: 'bar', BAZ: 'qux' })
      .env({ ANOTHER: 'var' });
    
    expect(cmd.options.env).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
      ANOTHER: 'var'
    });
  });

  test('working directory configuration', () => {
    const cmd = $.command('pwd').cwd('/tmp');
    expect(cmd.options.cwd).toBe('/tmp');
  });

  test('stdin configuration', () => {
    const cmd = $.command('cat').stdin('hello world');
    expect(cmd.options.stdin).toBe('hello world');
  });

  test('stderr configuration', () => {
    const cmd = $.command('cat', 'nonexistent.txt').stderr('ignore');
    expect(cmd.options.stderr).toBe('ignore');
  });

  test('run method returns ProcessRunner', () => {
    const cmd = $.command('echo', 'hello');
    const runner = cmd.run();
    
    // Should return a ProcessRunner-like object
    expect(runner).toBeDefined();
    expect(typeof runner.then).toBe('function'); // Should be thenable
  });

  test('direct command function usage', () => {
    const cmd = command('echo', 'hello');
    expect(cmd).toBeInstanceOf(CommandBuilder);
    expect(cmd.cmd).toBe('echo');
    expect(cmd.args).toEqual(['hello']);
  });

  test('numeric arguments converted to strings', () => {
    const cmd = $.command('echo', 42, 3.14);
    expect(cmd.args).toEqual(['42', '3.14']);
    
    const builtCommand = cmd.buildCommand();
    expect(builtCommand).toBe("echo '42' '3.14'");
  });
});

describe('Command Builder Integration', () => {
  test('can execute simple echo command', async () => {
    const result = await $.command('echo', 'hello world').run();
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.code).toBe(0);
  });

  test('can execute cat command with file', async () => {
    // Create a temp file first using the built-in echo command
    const tempContent = 'test content\nsecond line';
    const writeResult = await $.command('sh', '-c', `echo "${tempContent}" > /tmp/test-command-builder.txt`).run();
    expect(writeResult.code).toBe(0);
    
    const result = await $.command('cat', '/tmp/test-command-builder.txt').run();
    expect(result.stdout.trim()).toBe(tempContent);
    expect(result.code).toBe(0);
    
    // Cleanup
    await $.command('rm', '-f', '/tmp/test-command-builder.txt').run();
  });

  test('pipe configuration works with execution', async () => {
    const result = await $.command('echo', 'hello')
      .pipe(
        $.command.stdout('inherit'),
        $.command.capture(true)
      )
      .run();
    
    expect(result.stdout.trim()).toBe('hello');
  });

  test('environment variables work in execution', async () => {
    const result = await $.command('env')
      .env({ TEST_VAR: 'test_value' })
      .run({ capture: true, mirror: false });
    
    expect(result.stdout).toContain('TEST_VAR=test_value');
  });

  test('stdin input works', async () => {
    const result = await $.command('cat')
      .stdin('hello from stdin')
      .run({ capture: true, mirror: false });
    
    expect(result.stdout.trim()).toBe('hello from stdin');
  });
});

describe('Command Builder Safety', () => {
  test('prevents shell injection in arguments', async () => {
    // This should NOT execute the embedded command
    const maliciousArg = 'hello; echo "injected"';
    const result = await $.command('echo', maliciousArg).run();
    
    // Should output the literal string, not execute the embedded command
    expect(result.stdout.trim()).toBe(maliciousArg);
    expect(result.stdout).not.toContain('injected\n');
  });

  test('handles special characters safely', async () => {
    const specialChars = '$HOME && rm -rf / || echo "danger"';
    const result = await $.command('echo', specialChars).run();
    
    // Should output the literal string
    expect(result.stdout.trim()).toBe(specialChars);
  });

  test('handles empty arguments', () => {
    const cmd = $.command('echo', '', 'hello', '');
    const builtCommand = cmd.buildCommand();
    expect(builtCommand).toBe("echo '' 'hello' ''");
  });
});