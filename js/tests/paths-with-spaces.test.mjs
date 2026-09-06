// Paths with spaces (issue #41).
//
// Interpolating a value must behave like referencing a quoted variable in sh:
// `$`cat ${file}`` is `cat "$file"`, so the value stays one argument no matter
// which characters it contains. These tests pin that for paths with spaces
// across quoting contexts, compare a battery of cases against /bin/sh, and
// exercise real file operations in a directory whose name contains spaces.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, afterEach, beforeAll, afterAll } from 'bun:test';
import {
  $,
  disableVirtualCommands,
  enableVirtualCommands,
  quote,
  setPreQuotedPassthroughEnabled,
} from '../src/$.mjs';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup

const PRINTER = fileURLToPath(
  new URL('./fixtures/argprint.mjs', import.meta.url)
);

const isWindows = process.platform === 'win32';

// The fixture prints one `ARG[...]` block per argument; a block may span
// several lines when the argument itself contains a newline.
function argsOf(stdout) {
  return [...stdout.matchAll(/^ARG\[([\s\S]*?)\]$/gm)].map((m) => m[1]);
}

// Build a template literal object from a plain string containing one `\0`
// marker where the value should be interpolated, so one string can describe
// both the command-stream template and the sh reference script.
function templateFrom(text) {
  const parts = text.split('\0');
  return Object.assign(parts, { raw: parts });
}

afterEach(() => {
  setPreQuotedPassthroughEnabled(null);
  enableVirtualCommands();
});

// --- command building ------------------------------------------------------

test('a path with spaces becomes a single quoted argument', () => {
  const filePath = '/Users/john/My Documents/report.txt';
  const cmd = $({ mirror: false })`cat ${filePath}`;
  expect(cmd.spec.command).toBe("cat '/Users/john/My Documents/report.txt'");
});

test('quote() treats every path as literal text', () => {
  expect(quote('/Users/john/My Documents/report.txt')).toBe(
    "'/Users/john/My Documents/report.txt'"
  );
  expect(quote('C:\\Program Files\\App\\app.exe')).toBe(
    "'C:\\Program Files\\App\\app.exe'"
  );
  // Quote characters in the value are data, exactly like "$var" in sh - they
  // are not treated as quoting the value (issue #41).
  expect(quote("'/My Documents/report.txt'")).toBe(
    "''\\''/My Documents/report.txt'\\'''"
  );
  expect(quote('"/My Documents/report.txt"')).toBe(
    '\'"/My Documents/report.txt"\''
  );
  // A value that needs no quoting at all is still passed through untouched.
  expect(quote('/Users/john/report.txt')).toBe('/Users/john/report.txt');
});

test('quote() keeps quotes balanced for values mixing both quote kinds', () => {
  // The old "already double-quoted" shortcut emitted '"it's"', which the shell
  // rejects as an unterminated string (issue #41).
  expect(quote('"it\'s"')).toBe("'\"it'\\''s\"'");
});

test('a path with spaces inside author quotes is spliced in literally', () => {
  const filePath = '/Users/john/My Documents/report.txt';
  expect($({ mirror: false })`cat "${filePath}"`.spec.command).toBe(
    'cat "/Users/john/My Documents/report.txt"'
  );
  expect($({ mirror: false })`cat '${filePath}'`.spec.command).toBe(
    "cat '/Users/john/My Documents/report.txt'"
  );
});

test('an array of paths with spaces becomes one argument each', () => {
  const files = ['/tmp/My Documents/a.txt', '/tmp/b.txt'];
  expect($({ mirror: false })`cat ${files}`.spec.command).toBe(
    "cat '/tmp/My Documents/a.txt' /tmp/b.txt"
  );
});

// --- argv fidelity ---------------------------------------------------------

const ARGV_VALUES = [
  ['spaces', '/Users/john/My Documents/report.txt'],
  ['windows path', 'C:\\Program Files\\App\\app.exe'],
  ['apostrophe', "/tmp/it's a dir/file.txt"],
  ['double quotes', '/tmp/quoted "name"/f.txt'],
  ['single-quoted value', "'/tmp/My Documents/f.txt'"],
  ['double-quoted value', '"/tmp/My Documents/f.txt"'],
  ['dollar sign', '/tmp/$HOME dir/f.txt'],
  ['glob', '/tmp/glob* dir/f.txt'],
  ['leading and trailing spaces', '  /tmp/spaced  '],
  ['backslash', '/tmp/back\\slash dir/f.txt'],
  ['tab', '/tmp/tab\there/f.txt'],
  ['newline', '/tmp/new\nline/f.txt'],
  ['emoji', '/tmp/emoji 🚀 dir/f.txt'],
  ['shell operators', '/tmp/a; echo pwned | b && c/f.txt'],
  ['command substitution text', '/tmp/$(echo pwned)/f.txt'],
];

const ARGV_CONTEXTS = [
  ['unquoted', `node "${PRINTER}" \0`],
  ['double-quoted', `node "${PRINTER}" "\0"`],
  ['single-quoted', `node "${PRINTER}" '\0'`],
];

for (const [contextName, script] of ARGV_CONTEXTS) {
  for (const [valueName, value] of ARGV_VALUES) {
    test.skipIf(isWindows)(
      `${contextName} interpolation keeps "${valueName}" as one argument`,
      async () => {
        const result = await $({ mirror: false })(templateFrom(script), value);
        expect(argsOf(result.stdout)).toEqual([value]);
      }
    );
  }
}

test.skipIf(isWindows)(
  'a path with spaces stays one argument for a real binary too',
  async () => {
    disableVirtualCommands();
    const value = '/Users/john/My Documents/report.txt';
    const result = await $({ mirror: false })`node ${PRINTER} ${value}`;
    expect(argsOf(result.stdout)).toEqual([value]);
  }
);

// --- parity with /bin/sh ---------------------------------------------------

// Each case pairs a command-stream template (with `\0` at the interpolation
// point) with the sh script it must behave like. Interpolation corresponds to
// a *quoted* variable reference, which is why the reference uses "$V" wherever
// the template interpolates outside quotes.
// `printf '%s\\n'` rather than `echo`, because /bin/sh's echo expands
// backslash escapes on some systems (dash does, bash does not) - a difference
// between echo implementations, not a difference in how the path is passed.
const PARITY_CASES = [
  ['unquoted path', "printf '%s\\n' \0", `printf '%s\\n' "$V"`],
  ['double-quoted path', `printf '%s\\n' "\0"`, `printf '%s\\n' "$V"`],
  ['single-quoted path', "printf '%s\\n' '\0'", `printf '%s\\n' "$V"`],
  [
    'path inside a sentence',
    `printf '%s\\n' "file: \0 done"`,
    `printf '%s\\n' "file: $V done"`,
  ],
  [
    'path as one of several args',
    "printf '[%s]\\n' a \0 b",
    `printf '[%s]\\n' a "$V" b`,
  ],
  [
    'path with a suffix appended',
    "printf '%s\\n' \0.bak",
    `printf '%s\\n' "$V".bak`,
  ],
  [
    'path in a pipeline',
    "printf '%s\\n' \0 | cat",
    `printf '%s\\n' "$V" | cat`,
  ],
  [
    'path in a subcommand',
    `sh -c "printf '%s\\n' \0"`,
    `sh -c "printf '%s\\n' $V"`,
  ],
];

const PARITY_VALUES = ARGV_VALUES;

for (const [caseName, script, reference] of PARITY_CASES) {
  for (const [valueName, value] of PARITY_VALUES) {
    test.skipIf(isWindows)(
      `matches /bin/sh: ${caseName} with ${valueName}`,
      async () => {
        const expected = spawnSync('/bin/sh', ['-c', reference], {
          env: { ...process.env, V: value },
          encoding: 'utf8',
        });
        const result = await $({ mirror: false })(templateFrom(script), value);
        expect(result.stdout).toBe(expected.stdout);
        expect(result.code).toBe(expected.status);
      }
    );
  }
}

// --- real file operations --------------------------------------------------

let workDir;
let filePath;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my documents '));
  filePath = path.join(workDir, 'report file.txt');
  fs.writeFileSync(filePath, 'hello content\n');
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

test.skipIf(isWindows)('cat reads a file whose path has spaces', async () => {
  const result = await $({ mirror: false })`cat ${filePath}`;
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('hello content\n');
});

test.skipIf(isWindows)(
  'cat reads the file with author-written quotes too',
  async () => {
    expect((await $({ mirror: false })`cat "${filePath}"`).stdout).toBe(
      'hello content\n'
    );
    expect((await $({ mirror: false })`cat '${filePath}'`).stdout).toBe(
      'hello content\n'
    );
  }
);

test.skipIf(isWindows)(
  'cat reads the file without virtual commands',
  async () => {
    disableVirtualCommands();
    const result = await $({ mirror: false })`cat ${filePath}`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello content\n');
  }
);

test.skipIf(isWindows)('sync execution handles paths with spaces', () => {
  const result = $({ mirror: false })`cat ${filePath}`.sync();
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('hello content\n');
});

test.skipIf(isWindows)(
  'ls lists a directory whose name has spaces',
  async () => {
    const result = await $({ mirror: false })`ls ${workDir}`;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('report file.txt');
  }
);

test.skipIf(isWindows)('cp and mv work on paths with spaces', async () => {
  const copy = path.join(workDir, 'copy of report.txt');
  const moved = path.join(workDir, 'moved report.txt');
  expect((await $({ mirror: false })`cp ${filePath} ${copy}`).code).toBe(0);
  expect(fs.readFileSync(copy, 'utf8')).toBe('hello content\n');
  expect((await $({ mirror: false })`mv ${copy} ${moved}`).code).toBe(0);
  expect(fs.existsSync(copy)).toBe(false);
  expect(fs.readFileSync(moved, 'utf8')).toBe('hello content\n');
  expect((await $({ mirror: false })`rm ${moved}`).code).toBe(0);
  expect(fs.existsSync(moved)).toBe(false);
});

test.skipIf(isWindows)('mkdir creates a nested path with spaces', async () => {
  const nested = path.join(workDir, 'a b', 'c d');
  expect((await $({ mirror: false })`mkdir -p ${nested}`).code).toBe(0);
  expect(fs.statSync(nested).isDirectory()).toBe(true);
});

test.skipIf(isWindows)('redirection writes to a path with spaces', async () => {
  const target = path.join(workDir, 'redirected output.txt');
  const result = await $({ mirror: false })`echo redirected > ${target}`;
  expect(result.code).toBe(0);
  expect(fs.readFileSync(target, 'utf8')).toBe('redirected\n');
});

test.skipIf(isWindows)('a pipeline keeps the path in one piece', async () => {
  const result = await $({ mirror: false })`cat ${filePath} | grep hello`;
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('hello content\n');
});

test.skipIf(isWindows)(
  'cd enters a directory whose name has spaces',
  async () => {
    const result = await $({ mirror: false })`cd ${workDir} && pwd`;
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(fs.realpathSync(workDir));
  }
);

test.skipIf(isWindows)('test -f finds a path with spaces', async () => {
  const result = await $({ mirror: false })`test -f ${filePath} && echo found`;
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('found\n');
});

// --- injection safety ------------------------------------------------------

test.skipIf(isWindows)(
  'a value wrapped in quotes cannot inject a command (issue #41)',
  async () => {
    const marker = path.join(workDir, 'pwned.txt');
    const evil = `"' ; touch ${marker} ; '"`;
    const result = await $({ mirror: false })`node ${PRINTER} ${evil}`;
    expect(argsOf(result.stdout)).toEqual([evil]);
    expect(fs.existsSync(marker)).toBe(false);
  }
);

// --- legacy pre-quoted passthrough -----------------------------------------

test('pre-quoted passthrough can be re-enabled', () => {
  setPreQuotedPassthroughEnabled(true);
  // Opted in, a hand-quoted value is spliced in as shell syntax again.
  expect(quote("'/My Documents/report.txt'")).toBe(
    "'/My Documents/report.txt'"
  );
  expect(quote('"/My Documents/report.txt"')).toBe(
    '"/My Documents/report.txt"'
  );
  setPreQuotedPassthroughEnabled(false);
  expect(quote("'/My Documents/report.txt'")).toBe(
    "''\\''/My Documents/report.txt'\\'''"
  );
});

test('pre-quoted passthrough never emits unbalanced quotes', () => {
  setPreQuotedPassthroughEnabled(true);
  // A value whose own quoting is unbalanced falls back to literal quoting, so
  // the injection the old heuristic allowed stays impossible: the old code
  // wrapped `"a" ; touch pwned ; "b"` in single quotes and the shell then read
  // the value's quotes as syntax.
  expect(quote('"a" ; touch pwned ; "b"')).toBe('\'"a" ; touch pwned ; "b"\'');
  expect(quote("'a' ; touch pwned ; 'b'")).toBe(
    "''\\''a'\\'' ; touch pwned ; '\\''b'\\'''"
  );
});
