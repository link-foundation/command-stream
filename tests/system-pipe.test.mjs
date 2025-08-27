import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { $, shell, disableVirtualCommands } from '../$.mjs';
import { execSync } from 'child_process';

beforeEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
  disableVirtualCommands();
});

// Reset shell settings after each test to prevent interference with other test files
afterEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
});

const hasCommand = (cmd) => {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const hasJq = hasCommand('jq');

describe('System Command Piping (Issue #8)', () => {
  describe('Piping to jq', () => {
    test.skipIf(!hasJq)('should pipe echo output to jq for JSON processing', async () => {
      const result = await $`echo '{"message": "hi", "number": 42}' | jq .`;
      
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('"message": "hi"');
      expect(result.stdout).toContain('"number": 42');
    });

    test.skipIf(!hasJq)('should extract specific field with jq', async () => {
      const result = await $`echo '{"message": "hi", "number": 42}' | jq -r .message`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('hi');
    });

    test.skipIf(!hasJq)('should handle jq array operations', async () => {
      const result = await $`echo '[1,2,3,4,5]' | jq '. | length'`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('5');
    });

    test.skipIf(!hasJq)('should pipe cat output to jq', async () => {
      const result = await $`echo '{"foo": "bar"}' | jq .foo`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('"bar"');
    });
  });

  describe('Piping to grep', () => {
    test('should pipe to grep for pattern matching', async () => {
      const result = await $`printf "line1\\nline2\\nline3" | grep line2`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('line2');
    });

    test('should handle grep with flags', async () => {
      const result = await $`printf "Line1\\nline2\\nLINE3" | grep -i line`;
      
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Line1');
      expect(result.stdout).toContain('line2');
      expect(result.stdout).toContain('LINE3');
    });
  });

  describe('Piping to sed', () => {
    test('should pipe to sed for text substitution', async () => {
      const result = await $`echo "hello world" | sed 's/world/universe/'`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('hello universe');
    });

    test('should handle sed with multiple operations', async () => {
      const result = await $`echo "foo bar baz" | sed 's/foo/FOO/; s/baz/BAZ/'`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('FOO bar BAZ');
    });
  });

  describe('Piping to awk', () => {
    test('should pipe to awk for field extraction', async () => {
      const result = await $`echo "field1 field2 field3" | awk '{print $2}'`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('field2');
    });

    test('should handle awk with calculations', async () => {
      const result = await $`echo "1 2 3" | awk '{print $1 + $2 + $3}'`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('6');
    });
  });

  describe('Piping to wc', () => {
    test('should pipe to wc for line counting', async () => {
      const result = await $`printf "line1\\nline2\\nline3\\n" | wc -l`;
      
      expect(result.code).toBe(0);
      expect(parseInt(result.stdout.trim())).toBe(3);
    });

    test('should pipe to wc for word counting', async () => {
      const result = await $`echo "one two three four five" | wc -w`;
      
      expect(result.code).toBe(0);
      expect(parseInt(result.stdout.trim())).toBe(5);
    });
  });

  describe('Piping to cut', () => {
    test('should pipe to cut for field extraction', async () => {
      const result = await $`echo "a:b:c:d" | cut -d: -f2`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('b');
    });

    test('should handle cut with multiple fields', async () => {
      const result = await $`echo "1,2,3,4,5" | cut -d, -f2,4`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('2,4');
    });
  });

  describe('Piping to sort', () => {
    test('should pipe to sort for sorting lines', async () => {
      const result = await $`printf "banana\\napple\\ncherry" | sort`;
      
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines[0]).toBe('apple');
      expect(lines[1]).toBe('banana');
      expect(lines[2]).toBe('cherry');
    });

    test('should handle sort with reverse flag', async () => {
      const result = await $`printf "1\\n3\\n2" | sort -r`;
      
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines[0]).toBe('3');
      expect(lines[1]).toBe('2');
      expect(lines[2]).toBe('1');
    });
  });

  describe('Piping to head/tail', () => {
    test('should pipe to head for first lines', async () => {
      const result = await $`printf "1\\n2\\n3\\n4\\n5" | head -n 2`;
      
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('1');
      expect(lines[1]).toBe('2');
    });

    test('should pipe to tail for last lines', async () => {
      const result = await $`printf "1\\n2\\n3\\n4\\n5" | tail -n 2`;
      
      expect(result.code).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('4');
      expect(lines[1]).toBe('5');
    });
  });

  describe('Complex multi-pipe operations', () => {
    test('should handle multiple system command pipes', async () => {
      const result = await $`printf "apple\\nbanana\\ncherry\\napricot" | grep ^a | sort | head -n 1`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('apple');
    });

    test.skipIf(!hasJq)('should combine jq with other tools', async () => {
      const result = await $`echo '[{"name":"alice"},{"name":"bob"},{"name":"charlie"}]' | jq -r '.[].name' | sort | tail -n 1`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('charlie');
    });

    test('should handle pipes with text processing chain', async () => {
      const result = await $`echo "foo bar baz foo bar" | sed 's/foo/FOO/g' | awk '{print NF}'`;
      
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('5');
    });
  });
});