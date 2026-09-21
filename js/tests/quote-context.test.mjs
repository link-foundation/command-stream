// Quote-context aware interpolation (issue #49).
//
// When a template puts an interpolation inside quotes the author wrote -
// $`bash -c "${script}"` - the value is spliced into those quotes as escaped
// literal text, exactly like "$var" in a POSIX shell, instead of being wrapped
// in a second pair of quotes. These tests pin both the generated command string
// and the observable behaviour, and compare a battery of cases against /bin/sh.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, afterEach } from 'bun:test';
import { $, literal, raw } from '../src/$.mjs';
import {
  buildShellCommand,
  escapeForDoubleQuotes,
  escapeForSingleQuotes,
  quoteForContext,
  scanQuoteContext,
  setQuoteContextEnabled,
  CONTEXT_DOUBLE,
  CONTEXT_SINGLE,
  CONTEXT_UNQUOTED,
} from '../src/$.quote.mjs';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup

const PRINTER = fileURLToPath(
  new URL('./fixtures/argprint.mjs', import.meta.url)
);

const isWindows = process.platform === 'win32';

function argsOf(stdout) {
  return stdout
    .split('\n')
    .filter((l) => l.startsWith('ARG['))
    .map((l) => l.slice(4, -1));
}

// Build a template literal object from a plain string containing one `\0`
// marker where the value should be interpolated. Lets the parity table below
// describe both the sh script and the command-stream template with one string.
function templateFrom(text) {
  const parts = text.split('\0');
  return Object.assign(parts, { raw: parts });
}

afterEach(() => {
  setQuoteContextEnabled(null);
});

// --- context scanning ------------------------------------------------------

test('scanQuoteContext tracks the quoting state of template text', () => {
  expect(scanQuoteContext('echo ')).toBe(CONTEXT_UNQUOTED);
  expect(scanQuoteContext('bash -c "')).toBe(CONTEXT_DOUBLE);
  expect(scanQuoteContext("echo '")).toBe(CONTEXT_SINGLE);
  expect(scanQuoteContext('echo "closed" ')).toBe(CONTEXT_UNQUOTED);
  // A quote of the other kind is ordinary text inside quotes.
  expect(scanQuoteContext('echo "it\'s ')).toBe(CONTEXT_DOUBLE);
  expect(scanQuoteContext("echo 'say \"hi' ")).toBe(CONTEXT_UNQUOTED);
  // Backslash escapes do not open or close a context.
  expect(scanQuoteContext('echo "a \\" ')).toBe(CONTEXT_DOUBLE);
  expect(scanQuoteContext('echo \\" ')).toBe(CONTEXT_UNQUOTED);
  // State carries over from a previous chunk.
  expect(scanQuoteContext('b"', CONTEXT_DOUBLE)).toBe(CONTEXT_UNQUOTED);
});

// --- escaping primitives ---------------------------------------------------

test('escapeForDoubleQuotes escapes only what "..." still interprets', () => {
  expect(escapeForDoubleQuotes('plain text')).toBe('plain text');
  expect(escapeForDoubleQuotes('$HOME')).toBe('\\$HOME');
  expect(escapeForDoubleQuotes('`date`')).toBe('\\`date\\`');
  expect(escapeForDoubleQuotes('say "hi"')).toBe('say \\"hi\\"');
  expect(escapeForDoubleQuotes('a\\b')).toBe('a\\\\b');
  // Apostrophes and globs are literal inside double quotes already.
  expect(escapeForDoubleQuotes("it's *.js")).toBe("it's *.js");
});

test("escapeForSingleQuotes uses the POSIX '\\'' idiom", () => {
  expect(escapeForSingleQuotes('plain $text `x`')).toBe('plain $text `x`');
  expect(escapeForSingleQuotes("it's")).toBe("it'\\''s");
});

test('quoteForContext quotes normally outside quotes', () => {
  expect(quoteForContext('hello world', CONTEXT_UNQUOTED)).toBe(
    "'hello world'"
  );
  expect(quoteForContext('hello world')).toBe("'hello world'");
});

test('quoteForContext splices values into quotes without adding quotes', () => {
  expect(quoteForContext('hello world', CONTEXT_DOUBLE)).toBe('hello world');
  expect(quoteForContext('$x', CONTEXT_DOUBLE)).toBe('\\$x');
  expect(quoteForContext("it's", CONTEXT_SINGLE)).toBe("it'\\''s");
});

test('quoteForContext handles arrays, numbers and empty values', () => {
  // Inside quotes an array joins into one word, like "${arr[*]}" in sh.
  expect(quoteForContext(['a b', 'c'], CONTEXT_DOUBLE)).toBe('a b c');
  expect(quoteForContext(42, CONTEXT_DOUBLE)).toBe('42');
  // An absent value expands to nothing, like "$unset".
  expect(quoteForContext(null, CONTEXT_DOUBLE)).toBe('');
  expect(quoteForContext(undefined, CONTEXT_DOUBLE)).toBe('');
  expect(quoteForContext('', CONTEXT_DOUBLE)).toBe('');
  // Outside quotes the historical behaviour is unchanged.
  expect(quoteForContext(null, CONTEXT_UNQUOTED)).toBe("''");
  expect(quoteForContext('', CONTEXT_UNQUOTED)).toBe("''");
});

// --- command building ------------------------------------------------------

test('buildShellCommand keeps single quotes for unquoted positions', () => {
  expect(buildShellCommand(['echo ', ''], ['hello world'])).toBe(
    "echo 'hello world'"
  );
  expect(buildShellCommand(['ls ', ''], [['a b', 'c']])).toBe("ls 'a b' c");
});

test('buildShellCommand escapes into a double-quoted position (issue #49)', () => {
  const script = 'for file in *.js; do echo "Processing: $file"; done';
  expect(buildShellCommand(['bash -c "', '"'], [script])).toBe(
    'bash -c "for file in *.js; do echo \\"Processing: \\$file\\"; done"'
  );
});

test('buildShellCommand escapes into a single-quoted position', () => {
  expect(buildShellCommand(["echo '", "'"], ["it's here"])).toBe(
    "echo 'it'\\''s here'"
  );
});

test('buildShellCommand tracks context across several interpolations', () => {
  const cmd = buildShellCommand(
    ['echo "', '" and ', ' and "', '"'],
    ['a b', 'c d', '$e']
  );
  expect(cmd).toBe('echo "a b" and \'c d\' and "\\$e"');
});

test('buildShellCommand does not treat an escaped quote as a delimiter', () => {
  // The template's \" stays inside the double-quoted string.
  expect(buildShellCommand(['echo "a \\" ', '"'], ['b c'])).toBe(
    'echo "a \\" b c"'
  );
});

test('raw() still bypasses quoting inside quotes', () => {
  expect(buildShellCommand(['bash -c "', '"'], [raw('echo $HOME')])).toBe(
    'bash -c "echo $HOME"'
  );
});

test('literal() does not add a second pair of quotes inside quotes', () => {
  expect(
    buildShellCommand(['gh pr comment --body "', '"'], [literal("didn't")])
  ).toBe('gh pr comment --body "didn\'t"');
  // Outside quotes literal() keeps wrapping in double quotes as before.
  expect(
    buildShellCommand(['gh pr comment --body ', ''], [literal("didn't")])
  ).toBe('gh pr comment --body "didn\'t"');
});

// --- injection safety ------------------------------------------------------

test('a value cannot break out of a double-quoted position', () => {
  const evil = '"; rm -rf /tmp/nope; echo "';
  expect(buildShellCommand(['echo "', '"'], [evil])).toBe(
    'echo "\\"; rm -rf /tmp/nope; echo \\""'
  );
});

test('a value cannot break out of a single-quoted position', () => {
  const evil = "'; rm -rf /tmp/nope; echo '";
  expect(buildShellCommand(["echo '", "'"], [evil])).toBe(
    "echo ''\\''; rm -rf /tmp/nope; echo '\\'''"
  );
});

test.skipIf(isWindows)(
  'injection attempts stay data, not commands',
  async () => {
    const evil = '"; echo PWNED; "';
    const result = await $({ mirror: false })`echo "${evil}"`;
    expect(result.stdout).toBe(`${evil}\n`);
    expect(result.stdout).not.toContain('PWNED\n');
  }
);

// --- end-to-end behaviour --------------------------------------------------

test.skipIf(isWindows)(
  'issue #49: bash -c runs an interpolated script',
  async () => {
    const script = 'for f in one two; do echo "Processing: $f"; done';
    const result = await $({ mirror: false })`bash -c "${script}"`;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Processing: one\nProcessing: two\n');
  }
);

test.skipIf(isWindows)(
  'interpolated script keeps $ for the inner shell',
  async () => {
    const script = 'x=5; echo "x is $x"';
    const result = await $({ mirror: false })`bash -c "${script}"`;
    expect(result.stdout).toBe('x is 5\n');
  }
);

test.skipIf(isWindows)('a double-quoted value stays one argument', async () => {
  const value = 'two words';
  const result = await $({ mirror: false })`node ${PRINTER} "${value}"`;
  expect(argsOf(result.stdout)).toEqual(['two words']);
});

test.skipIf(isWindows)(
  'special characters survive a double-quoted position',
  async () => {
    const value = 'a $VAR `date` "quoted" \\slash it\'s';
    const result = await $({ mirror: false })`node ${PRINTER} "${value}"`;
    expect(argsOf(result.stdout)).toEqual([value]);
  }
);

test.skipIf(isWindows)(
  'special characters survive a single-quoted position',
  async () => {
    const value = 'a $VAR `date` "quoted" \\slash it\'s';
    const result = await $({ mirror: false })`node ${PRINTER} '${value}'`;
    expect(argsOf(result.stdout)).toEqual([value]);
  }
);

// --- opt-out ---------------------------------------------------------------

test('context-aware quoting can be disabled', () => {
  setQuoteContextEnabled(false);
  expect(buildShellCommand(['bash -c "', '"'], ['echo hi there'])).toBe(
    'bash -c "\'echo hi there\'"'
  );
  setQuoteContextEnabled(true);
  expect(buildShellCommand(['bash -c "', '"'], ['echo hi there'])).toBe(
    'bash -c "echo hi there"'
  );
});

// --- parity with /bin/sh ---------------------------------------------------

// Each case is a shell script with a single \0 marking the interpolation point.
// The reference runs the same script in /bin/sh with the value in $V, which is
// what "closer to sh" means concretely: interpolating a value must behave like
// referencing a variable holding it.
const PARITY_CASES = [
  ['double-quoted word', 'echo "\0"', 'hello world'],
  ['double-quoted dollar', 'echo "\0"', 'costs $5 for $USER'],
  ['double-quoted backticks', 'echo "\0"', 'a `date` b'],
  ['double-quoted quotes', 'echo "\0"', 'she said "hi", it\'s fine'],
  ['double-quoted backslash', 'echo "\0"', 'a\\b\\\\c'],
  ['double-quoted glob', 'echo "\0"', '*.js'],
  ['double-quoted operators', 'echo "\0"', 'a; echo pwned && b | c'],
  ['double-quoted substitution text', 'echo "\0"', '$(echo injected)'],
  ['double-quoted newline', 'echo "\0"', 'line1\nline2'],
  ['unquoted word', 'echo \0', 'hello world'],
  ['surrounded by text', 'echo "before-\0-after"', 'mid dle'],
  ['bash -c for loop', 'bash -c "\0"', 'for f in a b; do echo "got $f"; done'],
  ['bash -c pipeline', 'bash -c "\0"', 'printf "a\\nb\\n" | grep b'],
  ['bash -c conditional', 'bash -c "\0"', 'if [ -d /tmp ]; then echo yes; fi'],
  ['bash -c heredoc', 'bash -c "\0"', 'cat <<EOF\nheredoc line\nEOF'],
  [
    'bash -c function',
    'bash -c "\0"',
    'greet() { echo "hi $1"; }; greet world',
  ],
  ['bash -c nested quotes', 'sh -c "\0"', `echo 'single' && echo "double"`],
];

for (const [name, script, value] of PARITY_CASES) {
  test.skipIf(isWindows)(`matches /bin/sh: ${name}`, async () => {
    const reference = spawnSync('/bin/sh', ['-c', script.replace('\0', '$V')], {
      env: { ...process.env, V: value },
      encoding: 'utf8',
    });
    const result = await $({ mirror: false })(templateFrom(script), value);
    expect(result.stdout).toBe(reference.stdout);
    expect(result.code).toBe(reference.status);
  });
}
