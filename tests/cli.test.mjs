import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from 'child_process';
import path from 'path';

const CLI_PATH = path.resolve('./src/cli.mjs');

// Helper function to run CLI commands and get output
function runCLI(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      ...options,
      stdio: 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr
      });
    });
    
    child.on('error', reject);
  });
}

test('CLI help command', async () => {
  const result = await runCLI(['--help']);
  
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('$ CLI Tool - Command Stream Shell Utility');
  expect(result.stdout).toContain('Usage:');
  expect(result.stdout).toContain('-c \'command\'');
  expect(result.stdout).toContain('Virtual commands available');
});

test('CLI version command', async () => {
  const result = await runCLI(['--version']);
  
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('$ CLI Tool v0.7.1');
});

test('CLI echo virtual command', async () => {
  const result = await runCLI(['-c', 'echo "Hello World"']);
  
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe('Hello World');
});

test('CLI seq virtual command', async () => {
  const result = await runCLI(['-c', 'seq 1 3']);
  
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe('1\n2\n3');
});

test('CLI pwd virtual command', async () => {
  const result = await runCLI(['-c', 'pwd']);
  
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe(process.cwd());
});

test('CLI cd virtual command', async () => {
  const result = await runCLI(['-c', 'cd .. && pwd']);
  
  expect(result.code).toBe(0);
  // Should show parent directory
  expect(result.stdout.trim()).toBe(path.dirname(process.cwd()));
});

test('CLI ls virtual command', async () => {
  const result = await runCLI(['-c', 'ls']);
  
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('package.json');
  expect(result.stdout).toContain('src');
  expect(result.stdout).toContain('tests');
});

test('CLI with no command shows error', async () => {
  const result = await runCLI([]);
  
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Error: No command specified');
  expect(result.stderr).toContain('Use --help for usage information');
});

test('CLI with --command flag', async () => {
  const result = await runCLI(['--command', 'echo "test with long flag"']);
  
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe('test with long flag');
});

test('CLI sleep virtual command', async () => {
  const start = Date.now();
  const result = await runCLI(['-c', 'sleep 1']);
  const elapsed = Date.now() - start;
  
  expect(result.code).toBe(0);
  // Should take at least 800ms but less than 2000ms
  expect(elapsed).toBeGreaterThan(800);
  expect(elapsed).toBeLessThan(2000);
});

test('CLI which virtual command', async () => {
  const result = await runCLI(['-c', 'which node']);
  
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/\/.*node/);
});

test('CLI with real system commands', async () => {
  const result = await runCLI(['-c', 'whoami']);
  
  expect(result.code).toBe(0);
  expect(result.stdout.length).toBeGreaterThan(0);
});

test('CLI exit codes are preserved', async () => {
  const result = await runCLI(['-c', 'exit 42']);
  
  expect(result.code).toBe(42);
});

test('CLI error handling for invalid commands', async () => {
  const result = await runCLI(['-c', 'nonexistentcommand12345']);
  
  // Should exit with non-zero code
  expect(result.code).not.toBe(0);
});