import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { isWindows } from './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import {
  $,
  register,
  unregister,
  enableVirtualCommands,
  shell,
} from '../src/$.mjs';
import { trace } from '../src/$.utils.mjs';
import { tee as teeHandler } from '../src/commands/index.mjs';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// Test directory for safe file operations
const TEST_DIR = 'test-builtin-commands';

beforeEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);

  // Enable virtual commands for these tests
  enableVirtualCommands();

  // Create clean test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR);
});

afterEach(() => {
  // Clean up test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('Built-in Commands (Bun.$ compatible)', () => {
  describe('File Reading Commands', () => {
    test('cat should read file contents', async () => {
      const testFile = join(TEST_DIR, 'test.txt');
      writeFileSync(testFile, 'Hello World\nLine 2\n');

      const result = await $`cat ${testFile}`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('Hello World\nLine 2\n');
    });

    test('cat should read from stdin when no files provided', async () => {
      const result = await $`echo "input" | cat`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('input\n');
    });

    test('cat should handle non-existent files', async () => {
      const result = await $`cat nonexistent.txt`;
      expect(result.code).toBe(1);
      expect(result.stderr?.toString()).toContain('No such file or directory');
    });
  });

  describe('Directory Listing Commands', () => {
    test('ls should list directory contents', async () => {
      writeFileSync(join(TEST_DIR, 'file1.txt'), 'content');
      writeFileSync(join(TEST_DIR, 'file2.txt'), 'content');
      mkdirSync(join(TEST_DIR, 'subdir'));

      const result = await $`ls ${TEST_DIR}`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toContain('file1.txt');
      expect(result.stdout?.toString()).toContain('file2.txt');
      expect(result.stdout?.toString()).toContain('subdir');
    });

    test('ls should support -a flag for hidden files', async () => {
      writeFileSync(join(TEST_DIR, '.hidden'), 'content');
      writeFileSync(join(TEST_DIR, 'visible.txt'), 'content');

      const result = await $`ls -a ${TEST_DIR}`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toContain('.hidden');
      expect(result.stdout?.toString()).toContain('visible.txt');
    });

    test('ls should support -l flag for long format', async () => {
      writeFileSync(join(TEST_DIR, 'test.txt'), 'content');

      const result = await $`ls -l ${TEST_DIR}`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toContain('-rw-r--r--');
      expect(result.stdout?.toString()).toContain('test.txt');
    });
  });

  describe('File Creation Commands', () => {
    test('mkdir should create directories', async () => {
      const result = await $`mkdir ${join(TEST_DIR, 'newdir')}`;
      expect(result.code).toBe(0);
      expect(existsSync(join(TEST_DIR, 'newdir'))).toBe(true);
    });

    test('mkdir -p should create parent directories', async () => {
      const result = await $`mkdir -p ${join(TEST_DIR, 'parent', 'child')}`;
      expect(result.code).toBe(0);
      expect(existsSync(join(TEST_DIR, 'parent', 'child'))).toBe(true);
    });

    test('touch should create new files', async () => {
      const testFile = join(TEST_DIR, 'touched.txt');
      const result = await $`touch ${testFile}`;
      expect(result.code).toBe(0);
      expect(existsSync(testFile)).toBe(true);
    });

    test('touch should update existing file timestamps', async () => {
      const testFile = join(TEST_DIR, 'existing.txt');
      writeFileSync(testFile, 'content');
      const oldStat = require('fs').statSync(testFile);

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await $`touch ${testFile}`;
      expect(result.code).toBe(0);

      const newStat = require('fs').statSync(testFile);
      expect(newStat.mtime.getTime()).toBeGreaterThan(oldStat.mtime.getTime());
    });
  });

  describe('File Removal Commands', () => {
    test('rm should remove files', async () => {
      const testFile = join(TEST_DIR, 'to-remove.txt');
      writeFileSync(testFile, 'content');

      const result = await $`rm ${testFile}`;
      expect(result.code).toBe(0);
      expect(existsSync(testFile)).toBe(false);
    });

    test('rm should fail on directories without -r', async () => {
      const testDir = join(TEST_DIR, 'to-remove-dir');
      mkdirSync(testDir);

      const result = await $`rm ${testDir}`;
      expect(result.code).toBe(1);
      expect(result.stderr?.toString()).toContain('Is a directory');
      expect(existsSync(testDir)).toBe(true);
    });

    test('rm -r should remove directories recursively', async () => {
      const testDir = join(TEST_DIR, 'to-remove-recursive');
      mkdirSync(testDir);
      writeFileSync(join(testDir, 'file.txt'), 'content');

      const result = await $`rm -r ${testDir}`;
      expect(result.code).toBe(0);
      expect(existsSync(testDir)).toBe(false);
    });

    test('rm -f should suppress errors on non-existent files', async () => {
      const result = await $`rm -f nonexistent.txt`;
      expect(result.code).toBe(0);
    });
  });

  describe('File Copy/Move Commands', () => {
    test('cp should copy files', async () => {
      const source = join(TEST_DIR, 'source.txt');
      const dest = join(TEST_DIR, 'dest.txt');
      writeFileSync(source, 'test content');

      const result = await $`cp ${source} ${dest}`;
      expect(result.code).toBe(0);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toBe('test content');
    });

    test('cp -r should copy directories recursively', async () => {
      const sourceDir = join(TEST_DIR, 'source-dir');
      const destDir = join(TEST_DIR, 'dest-dir');
      mkdirSync(sourceDir);
      writeFileSync(join(sourceDir, 'file.txt'), 'content');

      const result = await $`cp -r ${sourceDir} ${destDir}`;
      expect(result.code).toBe(0);
      expect(existsSync(destDir)).toBe(true);
      expect(existsSync(join(destDir, 'file.txt'))).toBe(true);
    });

    test('mv should move/rename files', async () => {
      const source = join(TEST_DIR, 'source.txt');
      const dest = join(TEST_DIR, 'dest.txt');
      writeFileSync(source, 'test content');

      const result = await $`mv ${source} ${dest}`;
      expect(result.code).toBe(0);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toBe('test content');
    });

    test('mv should move files to directory', async () => {
      const source = join(TEST_DIR, 'source.txt');
      const destDir = join(TEST_DIR, 'dest-dir');
      writeFileSync(source, 'test content');
      mkdirSync(destDir);

      const result = await $`mv ${source} ${destDir}`;
      expect(result.code).toBe(0);
      expect(existsSync(source)).toBe(false);
      expect(existsSync(join(destDir, 'source.txt'))).toBe(true);
    });
  });

  describe('Path Utility Commands', () => {
    test('basename should extract filename', async () => {
      const result = await $`basename /path/to/file.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('file.txt');
    });

    test('basename should remove suffix', async () => {
      const result = await $`basename /path/to/file.txt .txt`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('file');
    });

    test('dirname should extract directory path', async () => {
      const result = await $`dirname /path/to/file.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('/path/to');
    });
  });

  describe('Sequence Generation Commands', () => {
    test('seq should generate number sequence', async () => {
      const result = await $`seq 1 3`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('1\n2\n3\n');
    });

    test('seq should handle single argument', async () => {
      const result = await $`seq 3`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('1\n2\n3\n');
    });

    test('seq should handle step argument', async () => {
      const result = await $`seq 1 2 5`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('1\n3\n5\n');
    });
  });

  describe('Streaming Commands', () => {
    test('yes should output repeatedly', async () => {
      // Test with a limit to avoid infinite output
      const chunks = [];
      let count = 0;

      for await (const chunk of $`yes hello`.stream()) {
        chunks.push(chunk.data.toString());
        count++;
        if (count >= 3) {
          break;
        }
      }

      expect(chunks.length).toBe(3);
      chunks.forEach((chunk) => {
        expect(chunk).toBe('hello\n');
      });
    });

    test('yes should default to "y"', async () => {
      const chunks = [];
      let count = 0;

      for await (const chunk of $`yes`.stream()) {
        chunks.push(chunk.data.toString());
        count++;
        if (count >= 2) {
          break;
        }
      }

      expect(chunks.length).toBe(2);
      chunks.forEach((chunk) => {
        expect(chunk).toBe('y\n');
      });
    });
  });

  describe('Command Location (which)', () => {
    // Skip on Windows - uses Unix 'which sh' command
    test.skipIf(isWindows)(
      'which should find existing system commands',
      async () => {
        // Test with a command that should definitely exist on all systems
        const result = await $`which sh`;
        expect(result.code).toBe(0);
        expect(result.stdout?.toString()).toMatch(/\/.*sh/); // Should contain path to sh
      }
    );

    test('which should find node/bun executable', async () => {
      // Test with node or bun depending on the environment
      const command = typeof Bun !== 'undefined' ? 'bun' : 'node';
      const result = await $`which ${command}`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toMatch(new RegExp(`.*${command}`));
    });

    test('which should find homebrew-installed commands (if available)', async () => {
      // Test with gh (GitHub CLI) which is commonly installed via homebrew
      const result = await $`which gh`;

      // Enable verbose mode to see debug info if this test fails
      if (result.code !== 0) {
        trace('BuiltinTest', 'DEBUG: which gh failed');
        trace('BuiltinTest', () => `Exit code: ${result.code}`);
        trace('BuiltinTest', () => `Stdout: ${JSON.stringify(result.stdout)}`);
        trace('BuiltinTest', () => `Stderr: ${JSON.stringify(result.stderr)}`);
        trace('BuiltinTest', () => `PATH: ${process.env.PATH}`);

        // Try to find gh manually to confirm it exists
        const manualCheck = await $`/usr/bin/which gh`.catch(() => ({
          code: 1,
          stdout: '',
          stderr: 'manual which failed',
        }));
        trace(
          'BuiltinTest',
          () => `Manual /usr/bin/which result: ${manualCheck}`
        );
      }

      // If gh is installed, it should return 0, otherwise skip this test
      // Note: We can't guarantee gh is installed on all systems
      if (result.code === 0) {
        expect(result.stdout?.toString()).toMatch(/.*gh/);
      } else {
        trace(
          'BuiltinTest',
          'Skipping gh test - command not found or which implementation bug'
        );
      }
    });

    test('which should return non-zero for non-existent commands', async () => {
      const result = await $`which nonexistent-command-12345`;
      expect(result.code).toBe(1);
      expect(result.stderr?.toString()).toContain(
        'no nonexistent-command-12345 in PATH'
      );
    });

    test('which should find built-in virtual commands', async () => {
      const result = await $`which echo`;
      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toContain('shell builtin');
    });

    test('which should handle missing arguments', async () => {
      const result = await $`which`;
      expect(result.code).toBe(1);
      expect(result.stderr?.toString()).toContain('missing operand');
    });
  });

  describe('Tee Command (Virtual)', () => {
    test('tee should be a virtual command, not the system binary', async () => {
      const result = await $`which tee`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('tee: shell builtin\n');
    });

    test('tee should write to file and stdout', async () => {
      const testFile = join(TEST_DIR, 'tee-output.txt');
      const result = await $`echo "Hello Tee!" | tee ${testFile}`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('Hello Tee!\n');
      expect(existsSync(testFile)).toBe(true);

      const fileContent = readFileSync(testFile, 'utf8');
      expect(fileContent).toBe('Hello Tee!\n');
    });

    // Mirrors the `tee` pipeline example in js/README.md.
    test('tee should keep a mid-pipeline stage flowing', async () => {
      const testFile = join(TEST_DIR, 'tee-midpipeline.txt');
      const result = await $`echo "deploying" | tee ${testFile} | cat`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('deploying\n');
      expect(readFileSync(testFile, 'utf8')).toBe('deploying\n');
    });

    test('tee should support multiple output files', async () => {
      const file1 = join(TEST_DIR, 'tee1.txt');
      const file2 = join(TEST_DIR, 'tee2.txt');
      const file3 = join(TEST_DIR, 'tee3.txt');

      const result =
        await $`echo "Multiple files" | tee ${file1} ${file2} ${file3}`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('Multiple files\n');

      [file1, file2, file3].forEach((file) => {
        expect(existsSync(file)).toBe(true);
        const content = readFileSync(file, 'utf8');
        expect(content).toBe('Multiple files\n');
      });
    });

    test('tee should support append mode with -a flag', async () => {
      const testFile = join(TEST_DIR, 'tee-append.txt');

      // First write
      await $`echo "First line" | tee ${testFile}`;

      // Append second line
      const result = await $`echo "Second line" | tee -a ${testFile}`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('Second line\n');

      const fileContent = readFileSync(testFile, 'utf8');
      expect(fileContent).toBe('First line\nSecond line\n');
    });

    test('tee should truncate existing files without -a', async () => {
      const testFile = join(TEST_DIR, 'tee-truncate.txt');
      writeFileSync(testFile, 'old content that is much longer\n');

      const result = await $({ stdin: 'new\n' })`tee ${testFile}`;

      expect(result.code).toBe(0);
      expect(readFileSync(testFile, 'utf8')).toBe('new\n');
    });

    test('tee should support long options', async () => {
      const testFile = join(TEST_DIR, 'tee-long-options.txt');

      await $({ stdin: 'first\n' })`tee ${testFile}`;
      const result = await $({
        stdin: 'second\n',
      })`tee --append --ignore-interrupts ${testFile}`;

      expect(result.code).toBe(0);
      expect(readFileSync(testFile, 'utf8')).toBe('first\nsecond\n');
    });

    test('tee should support clustered short options', async () => {
      const testFile = join(TEST_DIR, 'tee-clustered.txt');

      await $({ stdin: 'first\n' })`tee ${testFile}`;
      const result = await $({ stdin: 'second\n' })`tee -ai ${testFile}`;

      expect(result.code).toBe(0);
      expect(readFileSync(testFile, 'utf8')).toBe('first\nsecond\n');
    });

    test('tee should stop option parsing at --', async () => {
      const result = await $({
        stdin: 'literal\n',
        cwd: TEST_DIR,
      })`tee -- -a`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('literal\n');
      // `-a` after `--` is a file name, not the append flag.
      expect(readFileSync(join(TEST_DIR, '-a'), 'utf8')).toBe('literal\n');
      expect(existsSync(join(TEST_DIR, '--'))).toBe(false);
    });

    test('tee should treat a bare - as a file name', async () => {
      // GNU tee has no special case for `-`: it is a file named `-`.
      const result = await $({ stdin: 'dash\n', cwd: TEST_DIR })`tee -`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('dash\n');
      expect(readFileSync(join(TEST_DIR, '-'), 'utf8')).toBe('dash\n');
    });

    test('tee should work with direct stdin input', async () => {
      const testFile = join(TEST_DIR, 'tee-stdin.txt');
      const inputData = 'line1\nline2\nline3\n';

      const result = await $({ stdin: inputData })`tee ${testFile}`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe(inputData);

      const fileContent = readFileSync(testFile, 'utf8');
      expect(fileContent).toBe(inputData);
    });

    test('tee should handle empty input', async () => {
      const testFile = join(TEST_DIR, 'tee-empty.txt');

      const result = await $({ stdin: '' })`tee ${testFile}`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('');
      expect(existsSync(testFile)).toBe(true);

      const fileContent = readFileSync(testFile, 'utf8');
      expect(fileContent).toBe('');
    });

    test('tee without file operands should pass stdin through', async () => {
      const result = await $({ stdin: 'just stdout\n' })`tee`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('just stdout\n');
      expect(result.stderr?.toString()).toBe('');
    });

    test('tee should work in complex pipelines', async () => {
      const testFile = join(TEST_DIR, 'tee-pipeline.txt');

      const result = await $`echo "pipeline test" | tee ${testFile} | cat`;

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('pipeline test\n');

      const fileContent = readFileSync(testFile, 'utf8');
      expect(fileContent).toBe('pipeline test\n');
    });

    test('tee should report write errors and keep writing remaining targets', async () => {
      const invalidPath = '/invalid/path/tee-error.txt';
      const goodFile = join(TEST_DIR, 'tee-good.txt');

      const result = await $({
        stdin: 'error test',
      })`tee ${invalidPath} ${goodFile}`;

      expect(result.code).toBe(1);
      expect(result.stderr?.toString()).toBe(
        `tee: ${invalidPath}: No such file or directory\n`
      );
      // stdout and the remaining file are still written, like GNU tee.
      expect(result.stdout?.toString()).toBe('error test');
      expect(readFileSync(goodFile, 'utf8')).toBe('error test');
    });

    test('tee should reject unknown long options', async () => {
      const result = await $({ stdin: 'test' })`tee --unknown-option file.txt`;

      expect(result.code).toBe(1);
      expect(result.stderr?.toString()).toBe(
        "tee: unrecognized option '--unknown-option'\n"
      );
      expect(result.stdout?.toString()).toBe('');
      expect(existsSync('file.txt')).toBe(false);
    });

    test('tee should reject unknown short options', async () => {
      const result = await $({ stdin: 'test' })`tee -z file.txt`;

      expect(result.code).toBe(1);
      expect(result.stderr?.toString()).toBe("tee: invalid option -- 'z'\n");
      expect(existsSync('file.txt')).toBe(false);
    });

    test('tee should stop writing files when cancelled', async () => {
      const testFile = join(TEST_DIR, 'tee-cancelled.txt');

      const result = await teeHandler({
        args: [testFile],
        stdin: 'payload',
        isCancelled: () => true,
      });

      // SIGINT exit code, with the input still forwarded to stdout.
      expect(result.code).toBe(130);
      expect(result.stdout?.toString()).toBe('payload');
      expect(existsSync(testFile)).toBe(false);
    });

    test('tee -i should keep writing files when cancelled', async () => {
      const testFile = join(TEST_DIR, 'tee-ignore-interrupts.txt');

      const result = await teeHandler({
        args: ['-i', testFile],
        stdin: 'payload',
        isCancelled: () => true,
      });

      expect(result.code).toBe(0);
      expect(readFileSync(testFile, 'utf8')).toBe('payload');
    });
  });

  describe('Error Handling', () => {
    test('commands should return proper exit codes', async () => {
      const success = await $`true`;
      expect(success.code).toBe(0);

      const failure = await $`false`;
      expect(failure.code).toBe(1);
    });

    test('commands should provide helpful error messages', async () => {
      const result = await $`cat nonexistent.txt`;
      expect(result.code).toBe(1);
      expect(result.stderr?.toString()).toContain('cat:');
      expect(result.stderr?.toString()).toContain('nonexistent.txt');
    });

    test('commands should handle missing operands', async () => {
      const mkdirResult = await $`mkdir`;
      expect(mkdirResult.code).toBe(1);
      expect(mkdirResult.stderr?.toString()).toContain('missing operand');

      const rmResult = await $`rm`;
      expect(rmResult.code).toBe(1);
      expect(rmResult.stderr?.toString()).toContain('missing operand');
    });
  });
});
