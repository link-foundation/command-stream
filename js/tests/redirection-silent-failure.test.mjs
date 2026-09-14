// Issue #46: a command whose first word is a built-in (virtual) command used to
// be dispatched to that built-in with the shell operators still in the argument
// list. `git push ... 2>&1` reported exit code 0 and no output while nothing was
// pushed, and `echo hello > out.txt` printed `hello > out.txt` instead of
// writing the file.
//
// needsRealShell() already recognised those constructs, but the caller only
// consulted it when the command also contained `&&`, `||`, `;`, `&` or `(`.
// These tests pin the behaviour to /bin/sh, which is the contract: anything the
// built-ins cannot reproduce exactly goes to the system shell.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { isWindows } from './test-helper.mjs';
import { $ } from '../src/$.mjs';
import { needsRealShell } from '../src/shell-parser.mjs';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/** Run `command` in a scratch directory and report what /bin/sh does with it. */
function runInSh(command, cwd) {
  const sh = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8' });
  return { code: sh.status, stdout: sh.stdout, stderr: sh.stderr };
}

/** List the scratch directory as `name:contents` pairs, sorted by name. */
async function snapshot(dir) {
  const names = (await fs.readdir(dir)).sort();
  const entries = await Promise.all(
    names.map(
      async (name) =>
        `${name}:${await fs.readFile(path.join(dir, name), 'utf8')}`
    )
  );
  return entries;
}

describe('Redirection is never handed to a built-in as an argument (issue #46)', () => {
  let shDir;
  let csDir;

  beforeEach(async () => {
    await beforeTestCleanup();
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'issue46-'));
    shDir = path.join(base, 'sh');
    csDir = path.join(base, 'cs');
    await fs.mkdir(shDir);
    await fs.mkdir(csDir);
    await fs.writeFile(path.join(shDir, 'seed.txt'), 'seeded\n');
    await fs.writeFile(path.join(csDir, 'seed.txt'), 'seeded\n');
  });

  afterEach(async () => {
    await afterTestCleanup();
    if (shDir) {
      await fs.rm(path.dirname(shDir), { recursive: true, force: true });
    }
  });

  // Every command here starts with a word that is also a built-in, which is
  // exactly the shape that used to bypass the shell.
  const parityCases = [
    'echo hello > out.txt',
    'echo hello >> out.txt',
    'echo hello 1> out.txt',
    'echo one two > out.txt',
    'echo hello 2> err.txt',
    'true > out.txt',
    'seq 1 3 > out.txt',
    'basename /a/b > out.txt',
    'cat < seed.txt',
    'cat 0< seed.txt',
    'cat /definitely/missing/path 2>/dev/null',
    'ls /definitely/missing/path 2>/dev/null',
    'ls /definitely/missing/path 2>&1',
    'exit 3 2>&1',
    'echo a > out.txt && echo b >> out.txt',
    'false > out.txt || echo fallback > out.txt',
    // Quoted redirection characters are literal in sh, so they must stay
    // literal here too - the fix must not over-reach.
    'echo "a > b"',
    "echo 'a > b'",
  ];

  for (const command of parityCases) {
    test.skipIf(isWindows)(`matches /bin/sh for: ${command}`, async () => {
      const expected = runInSh(command, shDir);

      let actual;
      try {
        const result = await $({
          cwd: csDir,
          mirror: false,
        })`${{ raw: command }}`;
        actual = { code: result.code, stdout: result.stdout };
      } catch (error) {
        actual = { code: error.code, stdout: error.stdout };
      }

      expect(actual.stdout).toBe(expected.stdout);
      expect(actual.code).toBe(expected.code);
      expect(await snapshot(csDir)).toEqual(await snapshot(shDir));
    });
  }

  // Expansions reached the built-ins through the same gap: `echo $(echo hi)`
  // worked only because `(` counted as a shell operator, while `echo $HOME`
  // printed the literal text.
  const expansionCases = [
    'echo $HOME',
    'echo *',
    'echo ~',
    'echo `echo hi`',
    'echo $(echo hi)',
  ];

  for (const command of expansionCases) {
    test.skipIf(isWindows)(`expands like /bin/sh for: ${command}`, async () => {
      const expected = runInSh(command, shDir);
      const result = await $({
        cwd: csDir,
        mirror: false,
      })`${{ raw: command }}`;
      expect(result.stdout).toBe(expected.stdout);
      expect(result.code).toBe(expected.code);
    });
  }

  test.skipIf(isWindows)(
    'a failing git push reports the failure through 2>&1',
    async () => {
      // A local path that is not a repository fails the same way everywhere and
      // keeps the test off the network.
      const repo = path.join(csDir, 'repo');
      await fs.mkdir(repo);
      await $({ cwd: repo, mirror: false })`git init -q`;
      await $({
        cwd: repo,
        mirror: false,
      })`git config user.email test@example.com`;
      await $({ cwd: repo, mirror: false })`git config user.name Test`;
      await fs.writeFile(path.join(repo, 'file.txt'), 'content\n');
      await $({ cwd: repo, mirror: false })`git add file.txt`;
      await $({ cwd: repo, mirror: false })`git commit -q -m initial`;
      await $({
        cwd: repo,
        mirror: false,
      })`git remote add origin ${path.join(csDir, 'no-such-remote')}`;

      const result = await $({
        cwd: repo,
        mirror: false,
      })`git push origin HEAD 2>&1`;

      // Before the fix this was code 0 with an empty stdout: the whole command
      // had been swallowed by the virtual `git`-less dispatch path.
      expect(result.code).not.toBe(0);
      expect(result.stdout).toContain('fatal:');
    }
  );

  test('needsRealShell recognises redirection outside quotes only', () => {
    expect(needsRealShell('echo hello > out.txt')).toBe(true);
    expect(needsRealShell('echo hello >> out.txt')).toBe(true);
    expect(needsRealShell('cat < in.txt')).toBe(true);
    expect(needsRealShell('git push origin main 2>&1')).toBe(true);
    expect(needsRealShell('cat <<EOF')).toBe(true);

    expect(needsRealShell('echo hello')).toBe(false);
    expect(needsRealShell('echo "a > b"')).toBe(false);
    expect(needsRealShell("echo 'a < b'")).toBe(false);
  });
});
