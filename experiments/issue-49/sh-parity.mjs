#!/usr/bin/env node
// Compare command-stream interpolation with what /bin/sh does for "$V" / '$V' /
// $V in the same position. The reference is a real shell: the value is passed
// through the environment (so it is never re-parsed) and the same script text
// is run by sh.
import { spawnSync } from 'node:child_process';
import { $ } from '../../js/src/$.mjs';

// Each case: sh script text using $V, plus the value of V.
const cases = [
  {
    name: 'bash -c double quotes (issue #49)',
    sh: 'bash -c "$V"',
    value: 'for f in a.js b.js; do echo "Processing: $f"; done',
  },
  { name: 'echo double quotes', sh: 'echo "$V"', value: 'hello world' },
  {
    name: 'echo double quotes with $',
    sh: 'echo "$V"',
    value: 'price is $5 and $USER',
  },
  {
    name: 'echo double quotes with backticks',
    sh: 'echo "$V"',
    value: 'a `date` b',
  },
  {
    name: 'echo double quotes with quotes',
    sh: 'echo "$V"',
    value: 'she said "hi" and it\'s fine',
  },
  {
    name: 'echo double quotes with backslash',
    sh: 'echo "$V"',
    value: 'a\\b\\\\c',
  },
  // Inside '...' a real shell would not expand anything; command-stream splices
  // the value in as literal text, so the expected output is the value itself.
  {
    name: 'echo single quotes',
    sh: "echo '$V'",
    value: "literal $V and it's fine",
    expect: "literal $V and it's fine\n",
  },
  { name: 'echo unquoted', sh: 'echo $V', value: 'hello world' },
  {
    name: 'sh -c nested quoting',
    sh: 'sh -c "$V"',
    value: `echo 'single' && echo "double"`,
  },
  {
    name: 'double quotes with newline',
    sh: 'echo "$V"',
    value: 'line1\nline2',
  },
  { name: 'double quotes with glob', sh: 'echo "$V"', value: '*.js' },
  {
    name: 'double quotes with semicolons',
    sh: 'echo "$V"',
    value: 'a; echo pwned; b',
  },
  {
    name: 'double quotes command substitution text',
    sh: 'echo "$V"',
    value: '$(echo injected)',
  },
  {
    name: 'bash -c with here-doc',
    sh: 'bash -c "$V"',
    value: 'cat <<EOF\nhello heredoc\nEOF',
  },
  {
    name: 'bash -c with pipeline',
    sh: 'bash -c "$V"',
    value: 'printf "a\\nb\\n" | grep b',
  },
  {
    name: 'bash -c with if',
    sh: 'bash -c "$V"',
    value: 'if [ -n "$HOME" ]; then echo has-home; fi',
  },
  {
    name: 'bash -c with case',
    sh: 'bash -c "$V"',
    value: 'x=2; case $x in 2) echo two;; *) echo other;; esac',
  },
  {
    name: 'bash -c with while',
    sh: 'bash -c "$V"',
    value: 'i=0; while [ $i -lt 2 ]; do echo i=$i; i=$((i+1)); done',
  },
  {
    name: 'bash -c with func',
    sh: 'bash -c "$V"',
    value: 'greet() { echo "hi $1"; }; greet world',
  },
  {
    name: 'suffix after interpolation',
    sh: 'echo "prefix-$V-suffix"',
    value: 'mid dle',
  },
];

// Build the equivalent command-stream template dynamically from the sh script:
// $V is replaced by the interpolation point.
const runShell = (script, value) =>
  spawnSync('/bin/sh', ['-c', script], {
    env: { ...process.env, V: value },
    encoding: 'utf8',
  });

let failures = 0;
for (const c of cases) {
  const parts = c.sh.split('$V');
  if (parts.length !== 2) {
    throw new Error(`case ${c.name} must contain exactly one $V`);
  }
  const strings = Object.assign([parts[0], parts[1]], {
    raw: [parts[0], parts[1]],
  });
  const ref =
    c.expect === undefined
      ? runShell(c.sh, c.value)
      : { stdout: c.expect, status: 0, stderr: '' };
  const got = await $(strings, c.value).run({ capture: true, mirror: false });
  const ok = got.stdout === ref.stdout && got.code === ref.status;
  if (!ok) {
    failures++;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}`);
  if (!ok) {
    console.log(
      `  sh   : code=${ref.status} stdout=${JSON.stringify(ref.stdout)} stderr=${JSON.stringify(ref.stderr)}`
    );
    console.log(
      `  cs   : code=${got.code} stdout=${JSON.stringify(got.stdout)} stderr=${JSON.stringify(got.stderr)}`
    );
  }
}
console.log(`\n${cases.length - failures}/${cases.length} cases match /bin/sh`);
process.exit(failures ? 1 : 0);
