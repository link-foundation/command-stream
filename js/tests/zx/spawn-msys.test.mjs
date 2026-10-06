// Git Bash on Windows (issue #26): the MSYS2/Cygwin runtime re-parses the
// command line Node and Bun build for `bash -c <cmd>`, and halves backslashes
// inside quotes. zx's `$'C:\\Users'` quoting therefore reached bash as
// `$'C:\Users'`. Upstream zx has the same flaw; its tests avoid such paths.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe } from 'node:test';
import { $ } from '../../src/zx/index.mjs';
import { isMsysShell, msysCommand } from '../../src/zx/spawn.mjs';

// libuv `quote_cmd_arg` (src/win/process.c), used by Node and Bun.
function libuvQuote(arg) {
  if (arg === '') {
    return '""';
  }
  if (!/[ \t"]/.test(arg)) {
    return arg;
  }
  if (!/["\\]/.test(arg)) {
    return `"${arg}"`;
  }
  let out = '';
  let quoteHit = true;
  for (let i = arg.length - 1; i >= 0; i--) {
    const ch = arg[i];
    out = ch + out;
    if (quoteHit && ch === '\\') {
      out = `\\${out}`;
    } else if (ch === '"') {
      quoteHit = true;
      out = `\\${out}`;
    } else {
      quoteHit = false;
    }
  }
  return `"${out}"`;
}

// msys2-runtime `globify` (winsup/cygwin/dcrt0.cc) for a word that is one
// double-quoted string: `\\` and `\"` lose the backslash, the rest is literal.
function msysUnquote(word) {
  assert.equal(word[0], '"', `not quoted: ${word}`);
  let out = '';
  let i = 1;
  for (; i < word.length && word[i] !== '"'; i++) {
    if (word[i] === '\\' && (word[i + 1] === '"' || word[i + 1] === '\\')) {
      i++;
    }
    out += word[i];
  }
  assert.equal(i, word.length - 1, `closed early: ${word}`);
  return out;
}

const cases = [
  'pwd',
  "echo $'C:\\\\Users\\\\a b'",
  'echo C:\\a\\cmd',
  'echo "\\"quoted\\""',
  'echo \\\\\\"',
  'printf %s \\',
  'printf %s \\\\',
  'echo "a\\\\" b',
  'echo ""',
  "echo $'\\\\\\\\server\\\\share'",
  'C:\\tools\\app.exe --flag',
  "set -euo pipefail;echo $'\\\\a\\\\cb'",
];

describe('Git Bash command line', () => {
  test('msysCommand() survives libuv quoting and the MSYS parser', () => {
    for (const cmd of cases) {
      const received = msysUnquote(libuvQuote(msysCommand(cmd)));
      // The leading space is part of the `bash -c` script and changes nothing.
      assert.equal(received, ` ${cmd}`, JSON.stringify(cmd));
    }
  });

  test('the raw command is mangled without it', () => {
    const cmd = "echo $'C:\\\\a\\\\cb'";
    assert.equal(msysUnquote(libuvQuote(cmd)), "echo $'C:\\a\\cb'");
  });

  test('isMsysShell() finds the MSYS2 and Cygwin runtimes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-msys-'));
    try {
      const layout = {
        'git/usr/bin/msys-2.0.dll': '',
        'git/usr/bin/bash.exe': '',
        'git/bin/bash.exe': '',
        'cygwin/bin/cygwin1.dll': '',
        'cygwin/bin/bash.exe': '',
        'wsl/bash.exe': '',
      };
      for (const [file, body] of Object.entries(layout)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), body);
      }
      assert.equal(isMsysShell(path.join(root, 'git/usr/bin/bash.exe')), true);
      assert.equal(isMsysShell(path.join(root, 'git/bin/bash.exe')), true);
      assert.equal(isMsysShell(path.join(root, 'cygwin/bin/bash.exe')), true);
      assert.equal(isMsysShell(path.join(root, 'wsl/bash.exe')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test(
    'backslashes reach Git Bash intact',
    { skip: process.platform !== 'win32' },
    async () => {
      for (const arg of [
        'D:\\a\\command-stream\\x.mjs',
        '\\\\server\\share\\',
        'a\\"b',
        'tail\\',
      ]) {
        const { stdout } = await $({ quiet: true })`printf %s ${arg}`;
        assert.equal(stdout, arg);
      }
    }
  );
});
