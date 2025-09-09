import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { $ } from '../src/$.mjs';

describe('New Commands for ShellJS compatibility', () => {
  beforeAll(async () => {
    // Create test files
    await $`printf "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n" > /tmp/test-head-tail.txt`;
    await $`printf "zebra\napple\nbanana\napple\ncherry\nbanana\ndate\n" > /tmp/test-sort-uniq.txt`;
  });

  afterAll(async () => {
    // Cleanup test files
    await $`rm -f /tmp/test-head-tail.txt /tmp/test-sort-uniq.txt`;
  });

  describe('head command', () => {
    test('should show first 10 lines by default', async () => {
      const result = await $`head /tmp/test-head-tail.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('line1');
      expect(result.stdout).toContain('line10');
      expect(result.stdout.split('\n').filter(l => l.trim()).length).toBe(10);
    });

    test('should respect -n flag', async () => {
      const result = await $`head -n 3 /tmp/test-head-tail.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('line1\nline2\nline3\n');
    });

    test('should handle -3 format', async () => {
      const result = await $`head -3 /tmp/test-head-tail.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('line1\nline2\nline3\n');
    });

    test('should handle nonexistent files', async () => {
      const result = await $`head /tmp/nonexistent-file.txt`;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No such file or directory');
    });
  });

  describe('tail command', () => {
    test('should show last 10 lines by default', async () => {
      const result = await $`tail /tmp/test-head-tail.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('line1');
      expect(result.stdout).toContain('line10');
      expect(result.stdout.split('\n').filter(l => l.trim()).length).toBe(10);
    });

    test('should respect -n flag', async () => {
      const result = await $`tail -n 3 /tmp/test-head-tail.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('line8\nline9\nline10\n');
    });

    test('should handle -3 format', async () => {
      const result = await $`tail -3 /tmp/test-head-tail.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('line8\nline9\nline10\n');
    });

    test('should handle nonexistent files', async () => {
      const result = await $`tail /tmp/nonexistent-file.txt`;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No such file or directory');
    });
  });

  describe('sort command', () => {
    test('should sort lines alphabetically', async () => {
      const result = await $`sort /tmp/test-sort-uniq.txt`;
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines[0]).toBe('apple');
      expect(lines[1]).toBe('apple');
      expect(lines[2]).toBe('banana');
    });

    test('should reverse sort with -r flag', async () => {
      const result = await $`sort -r /tmp/test-sort-uniq.txt`;
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines[0]).toBe('zebra');
      expect(lines[lines.length - 1]).toBe('apple');
    });

    test('should remove duplicates with -u flag', async () => {
      const result = await $`sort -u /tmp/test-sort-uniq.txt`;
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines).toEqual(['apple', 'banana', 'cherry', 'date', 'zebra']);
    });
  });

  describe('uniq command', () => {
    test('should remove consecutive duplicates', async () => {
      const result = await $`sort /tmp/test-sort-uniq.txt | uniq`;
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines).toEqual(['apple', 'banana', 'cherry', 'date', 'zebra']);
    });

    test('should count occurrences with -c flag', async () => {
      const result = await $`sort /tmp/test-sort-uniq.txt | uniq -c`;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('2 apple');
      expect(result.stdout).toContain('2 banana');
      expect(result.stdout).toContain('1 cherry');
    });

    test('should show only duplicates with -d flag', async () => {
      const result = await $`sort /tmp/test-sort-uniq.txt | uniq -d`;
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines).toEqual(['apple', 'banana']);
    });

    test('should show only unique lines with -u flag', async () => {
      const result = await $`sort /tmp/test-sort-uniq.txt | uniq -u`;
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines).toEqual(['cherry', 'date', 'zebra']);
    });
  });

  describe('Command count verification', () => {
    test('should have at least 25 built-in commands', async () => {
      const { listCommands } = await import('../src/$.mjs');
      const commands = listCommands();
      console.log('Available commands:', commands.sort());
      expect(commands.length).toBeGreaterThanOrEqual(25);
      
      // Verify new commands are included
      expect(commands).toContain('head');
      expect(commands).toContain('tail');
      expect(commands).toContain('sort');
      expect(commands).toContain('uniq');
    });
  });
});