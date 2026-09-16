// Regression tests for behaviours that used to differ between Node.js and Bun,
// or that silently diverged from the documented API.
//
// Every expectation here is runtime-independent on purpose: the whole point of
// these tests is that `bun test` and the Node parity runner
// (`node scripts/check-parity.mjs`) must observe the very same values.
import { describe, test, expect, afterEach } from 'bun:test';
import './test-helper.mjs';
import {
  $,
  register,
  unregister,
  shell,
  enableVirtualCommands,
} from '../src/$.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const $q = $({ mirror: false, capture: true });

const tempDirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-parity-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('result.text() is available on every execution path', () => {
  test('system command (async)', async () => {
    const result = await $q`sh -c 'echo system'`;
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('system\n');
  });

  test('built-in command (async)', async () => {
    const result = await $q`echo builtin`;
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('builtin\n');
  });

  test('built-in command (sync)', async () => {
    const result = $({ mirror: false })`echo builtin`.sync();
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('builtin\n');
  });

  test('pipeline', async () => {
    const result = await $q`echo a | cat`;
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('a\n');
  });

  test('.pipe() method', async () => {
    const result = await $({ mirror: false })`echo a`.pipe(
      $({ mirror: false })`cat`
    );
    expect(typeof result.text).toBe('function');
    expect(await result.text()).toBe('a\n');
  });

  test('virtual command', async () => {
    register('parity-text', async () => ({ stdout: 'virtual\n', code: 0 }));
    try {
      const result = await $q`parity-text`;
      expect(typeof result.text).toBe('function');
      expect(await result.text()).toBe('virtual\n');
    } finally {
      unregister('parity-text');
    }
  });
});

describe('virtual command stdin', () => {
  test('a standalone virtual command receives empty stdin, never the "inherit" sentinel', async () => {
    register('parity-stdin', async ({ stdin }) => ({
      stdout: JSON.stringify(stdin),
      code: 0,
    }));
    try {
      const result = await $q`parity-stdin`;
      expect(result.stdout).toBe('""');
    } finally {
      unregister('parity-stdin');
    }
  });

  test('a virtual command receives the previous built-in command output', async () => {
    register('parity-upper', async ({ stdin }) => ({
      stdout: String(stdin).toUpperCase(),
      code: 0,
    }));
    try {
      expect((await $q`echo abc | parity-upper`).stdout).toBe('ABC\n');
    } finally {
      unregister('parity-upper');
    }
  });

  test('a virtual command receives the previous system command output', async () => {
    register('parity-upper', async ({ stdin }) => ({
      stdout: String(stdin).toUpperCase(),
      code: 0,
    }));
    try {
      expect((await $q`sh -c 'echo sys' | parity-upper`).stdout).toBe('SYS\n');
    } finally {
      unregister('parity-upper');
    }
  });

  test('explicit stdin is forwarded to a virtual command', async () => {
    register('parity-upper', async ({ stdin }) => ({
      stdout: String(stdin).toUpperCase(),
      code: 0,
    }));
    try {
      const result = await $({
        mirror: false,
        capture: true,
        stdin: 'given\n',
      })`parity-upper`;
      expect(result.stdout).toBe('GIVEN\n');
    } finally {
      unregister('parity-upper');
    }
  });

  test('the handler context exposes the documented fields', async () => {
    let seen;
    register('parity-ctx', async (ctx) => {
      seen = ctx;
      return { stdout: '', code: 0 };
    });
    try {
      await $({
        mirror: false,
        capture: true,
        cwd: os.tmpdir(),
      })`parity-ctx one two`;
      expect(seen.args).toEqual(['one', 'two']);
      expect(seen.stdin).toBe('');
      expect(seen.cwd).toBe(os.tmpdir());
      expect(typeof seen.isCancelled).toBe('function');
      expect(seen.options).toBeDefined();
      expect(seen.env).toBeDefined();
    } finally {
      unregister('parity-ctx');
    }
  });
});

describe('pipeline exit codes', () => {
  test('the exit code of the last virtual command is propagated', async () => {
    register('parity-fail', async () => ({
      stdout: '',
      stderr: 'boom\n',
      code: 7,
    }));
    try {
      const result = await $q`echo a | parity-fail`;
      expect(result.code).toBe(7);
      expect(result.stderr).toContain('boom');
    } finally {
      unregister('parity-fail');
    }
  });

  test('the exit code of the last system command is propagated', async () => {
    const result = await $q`echo a | sh -c 'exit 7'`;
    expect(result.code).toBe(7);
  });

  test('a failing built-in command in the last position is propagated', async () => {
    const result = await $q`echo a | cat /definitely/not/here`;
    expect(result.code).not.toBe(0);
  });

  test('a failure in an earlier stage does not mask the final exit code', async () => {
    register('parity-fail', async () => ({
      stdout: '',
      stderr: 'boom\n',
      code: 7,
    }));
    try {
      const result = await $q`parity-fail | cat`;
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('boom');
    } finally {
      unregister('parity-fail');
    }
  });
});

describe('output redirection with built-in and virtual commands', () => {
  test('`command > file` writes the file instead of passing ">" as an argument', async () => {
    const file = path.join(tempDir(), 'out.txt');
    const result = await $q`echo hello > ${file}`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(fs.readFileSync(file, 'utf8')).toBe('hello\n');
  });

  test('`command >> file` appends', async () => {
    const file = path.join(tempDir(), 'out.txt');
    await $q`echo one > ${file}`;
    await $q`echo two >> ${file}`;
    expect(fs.readFileSync(file, 'utf8')).toBe('one\ntwo\n');
  });

  test('redirection at the end of a pipeline writes the file', async () => {
    const file = path.join(tempDir(), 'numbers.txt');
    const result = await $q`seq 1 3 | cat > ${file}`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(fs.readFileSync(file, 'utf8')).toBe('1\n2\n3\n');
  });

  test('a quoted ">" stays a literal argument', async () => {
    const result = await $q`echo "a > b"`;
    expect(result.stdout).toBe('a > b\n');
  });

  test('input redirection feeds a built-in command', async () => {
    const file = path.join(tempDir(), 'in.txt');
    fs.writeFileSync(file, 'from-file\n');
    const result = await $q`cat < ${file}`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('from-file\n');
  });
});

describe('built-in commands behave like their POSIX counterparts', () => {
  test('ls sorts entries by name, like real ls', async () => {
    // Other test files switch the built-ins off, so be explicit about needing
    // the built-in `ls` rather than the system one.
    enableVirtualCommands();
    const dir = tempDir();
    // Written in an order that is neither sorted nor reverse sorted, so a
    // readdir that happens to be ordered cannot make this pass by accident.
    for (const name of ['zebra.txt', 'alpha.txt', 'middle.txt']) {
      fs.writeFileSync(path.join(dir, name), '');
    }
    const result = await $q`ls ${dir}`;
    expect(result.stdout).toBe('alpha.txt\nmiddle.txt\nzebra.txt\n');
  });

  test('ls -a sorts the dot entries in too', async () => {
    enableVirtualCommands();
    const dir = tempDir();
    for (const name of ['visible.txt', '.hidden']) {
      fs.writeFileSync(path.join(dir, name), '');
    }
    const result = await $q`ls -a ${dir}`;
    expect(result.stdout).toBe('.hidden\nvisible.txt\n');
  });

  test('sleep does not keep the process alive after it finishes', async () => {
    // The built-in used to start an interval to poll for cancellation and never
    // clear it on the success path, so any script using `sleep` hung forever.
    const dir = tempDir();
    const script = path.join(dir, 'sleep-exit.mjs');
    const entry = path.resolve(
      import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
      '../src/$.mjs'
    );
    fs.writeFileSync(
      script,
      [
        `import { $ } from ${JSON.stringify(entry)};`,
        'await $({ mirror: false })`sleep 0.05`;',
        "console.log('finished');",
      ].join('\n')
    );

    const exited = await new Promise((resolve) => {
      const child = spawn(process.execPath, [script], { stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve('timed out');
      }, 10000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(`exited with ${code}`);
      });
    });
    expect(exited).toBe('exited with 0');
  }, 20000);
});

describe('pipefail reports an exit code instead of throwing', () => {
  afterEach(() => {
    shell.pipefail(false);
    shell.errexit(false);
  });

  test('without pipefail the last stage decides', async () => {
    const result = await $q`sh -c 'echo x; exit 3' | cat`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('x\n');
  });

  test('with pipefail the rightmost failing stage decides', async () => {
    shell.pipefail(true);
    const result = await $q`sh -c 'echo x; exit 3' | cat`;
    expect(result.code).toBe(3);
    // bash keeps the output of a pipeline that pipefail marked as failed.
    expect(result.stdout).toBe('x\n');
  });

  test('with pipefail a failing built-in stage decides', async () => {
    shell.pipefail(true);
    enableVirtualCommands();
    const result = await $q`false | cat`;
    expect(result.code).toBe(1);
  });

  test('with pipefail the rightmost failure wins over an earlier one', async () => {
    shell.pipefail(true);
    const result = await $q`sh -c 'exit 3' | sh -c 'exit 4' | cat`;
    expect(result.code).toBe(4);
  });

  test('pipefail alone does not throw, errexit does', async () => {
    shell.pipefail(true);
    shell.errexit(true);
    let thrown = null;
    try {
      await $q`sh -c 'exit 3' | cat`;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBe(null);
    expect(thrown.code).toBe(3);
  });
});

describe('quoting survives the trip to a command', () => {
  // The built-in path parses the command line itself instead of handing it to a
  // shell, so it has to understand the same quoting the shell would. Each case
  // below asserts that a built-in and the system command agree.
  const cases = [
    ["it's a name", 'an apostrophe inside the value'],
    ['two  spaces', 'repeated spaces'],
    ['say "hi"', 'double quotes inside the value'],
    ['back\\slash', 'a backslash'],
    ['a|b', 'a pipe character'],
    ['$HOME', 'something that looks like a variable'],
  ];

  for (const [value, description] of cases) {
    test(`echo passes through ${description}`, async () => {
      enableVirtualCommands();
      const builtin = await $q`echo ${value}`;
      expect(builtin.stdout).toBe(`${value}\n`);
    });
  }

  test('an interpolated apostrophe does not split the pipeline', async () => {
    enableVirtualCommands();
    const result = await $q`echo ${"it's a name"} | cat`;
    expect(result.stdout).toBe("it's a name\n");
  });

  test('a pipe inside a quoted argument is not a pipeline separator', async () => {
    enableVirtualCommands();
    const result = await $q`echo "a | b"`;
    expect(result.stdout).toBe('a | b\n');
  });

  test('adjacent quoted and unquoted pieces form one argument', async () => {
    enableVirtualCommands();
    const result = await $q`echo pre"in quotes"post`;
    expect(result.stdout).toBe('prein quotespost\n');
  });

  test('a system command still sees the shell expansion it was given', async () => {
    // `printf` has no built-in, so this goes to a real shell. Rebuilding the
    // command line must keep `$HOME` unexpanded for the shell to expand.
    const result = await $q`printf '%s' $HOME`;
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).not.toBe('$HOME');
  });

  test('a system command keeps a quoted expansion literal', async () => {
    const result = await $q`printf '%s' '$HOME'`;
    expect(result.stdout).toBe('$HOME');
  });

  test('the enhanced parser unquotes a path the same way', async () => {
    // A command line containing `&&` takes the enhanced parser instead of the
    // simple one. Both have to agree, or a directory created by one is
    // unreachable by the other.
    enableVirtualCommands();
    const dir = path.join(tempDir(), "odd-'name'-$1");
    await $q`mkdir -p ${dir}`;
    expect(fs.existsSync(dir)).toBe(true);
    const marker = 'parser-reached-directory.txt';
    const result = await $q`cd ${dir} && touch ${marker}`;
    expect(result.code).toBe(0);
    expect(fs.existsSync(path.join(dir, marker))).toBe(true);
  });
});
