/**
 * Tests for the `$fy` tool (shell -> mjs translator).
 *
 * The translator is rule-based: `formalizeShell` builds a meta-language links
 * network and `buildRuleSet` rewrites it. The tests below check both halves
 * separately and the CLI on top of them, and finish by executing a translated
 * script to prove the output is not merely well-shaped but correct.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LinkType } from 'meta-language';

import { $, enableVirtualCommands } from '../src/$.mjs';
import { formalizeShell, translateShellToMjs } from '../src/fy/index.mjs';
import { parseShellScript } from '../src/fy/shell-script-parser.mjs';

// Other test files call `disableVirtualCommands()` and never re-enable it, so
// `$fy` has to be re-enabled here or it would fall through to `/bin/sh`.
beforeEach(() => {
  enableVirtualCommands();
});

/** Translates `source` and returns the body without the generated preamble. */
function body(source) {
  const translated = translateShellToMjs(source, { shebang: false });
  expect(translated.diagnostics).toEqual([]);
  return translated.body.trim();
}

/** Collects the terms of every syntax node in a formalized script. */
function terms(source) {
  const { network } = formalizeShell(source);
  return network
    .links()
    .filter((link) => link.metadata().linkType === LinkType.Syntax)
    .map((link) => link.metadata().term);
}

describe('shell parser', () => {
  test('parses a pipeline into stages', () => {
    const script = parseShellScript('ls | grep test | wc -l');
    expect(script.term).toBe('script');
    expect(script.children[0].term).toBe('pipeline');
    expect(script.children[0].children).toHaveLength(3);
  });

  test('parses && and || left-associatively', () => {
    const script = parseShellScript('a && b || c');
    expect(script.children[0].term).toBe('or');
    expect(script.children[0].children[0].term).toBe('and');
  });

  test('parses control flow, functions and case', () => {
    const script = parseShellScript(`
      if [ -f x ]; then echo a; else echo b; fi
      while true; do echo loop; done
      for i in 1 2; do echo $i; done
      greet() { echo hi; }
      case "$1" in start) run ;; *) usage ;; esac
    `);
    expect(script.children.map((child) => child.term)).toEqual([
      'if',
      'while',
      'for',
      'function',
      'case',
    ]);
  });
});

describe('shell formalizer', () => {
  test('produces a meta-language network of typed syntax nodes', () => {
    const { network, root, terms: used } = formalizeShell('echo hi | wc -l');
    expect(network.link(root).metadata().linkType).toBe(LinkType.Syntax);
    expect(network.link(root).metadata().term).toBe('script');
    expect(network.link(root).metadata().language).toBe('Shell');
    expect(used.has('pipeline')).toBe(true);
    expect(used.has('command')).toBe(true);
  });

  test('classifies word expansions rather than treating words as text', () => {
    // `NAME` is assigned by the script, `HOME` is not, `$1` is positional.
    expect(terms('NAME=x\necho "$NAME $HOME $1 $(date)"')).toEqual(
      expect.arrayContaining([
        'variable',
        'env-variable',
        'positional',
        'substitution',
        'literal',
      ])
    );
  });

  test('keeps unsupported expansions instead of dropping them', () => {
    expect(terms('echo "${x#prefix}"')).toContain('unsupported-expansion');
    expect(body('echo "${x#prefix}"')).toContain('\\${x#prefix}');
  });
});

describe('translation rules', () => {
  test('translates a simple command', () => {
    expect(body('ls -la')).toBe('await $`ls -la`;');
  });

  test('keeps a pipeline as one shell invocation', () => {
    expect(body('ls -la | grep test')).toBe('await $`ls -la | grep test`;');
  });

  test('translates && into a status check, not a boolean', () => {
    expect(body('cd /tmp && pwd')).toBe(
      'if ((await $`cd /tmp`).code === 0) {\n  await $`pwd`;\n}'
    );
  });

  test('translates || into an inverted status check', () => {
    expect(body('test -f x || echo missing')).toBe(
      'if ((await $`test -f x`).code !== 0) {\n  await $`echo missing`;\n}'
    );
  });

  test('translates if/else', () => {
    expect(body('if [ -f x ]; then echo a; else echo b; fi')).toBe(
      'if ((await $`[ -f x ]`).code === 0) {\n' +
        '  await $`echo a`;\n' +
        '} else {\n' +
        '  await $`echo b`;\n' +
        '}'
    );
  });

  test('translates while and until', () => {
    expect(body('while true; do echo x; done')).toContain(
      'while ((await $`true`).code === 0) {'
    );
    expect(body('until false; do echo x; done')).toContain(
      'while ((await $`false`).code !== 0) {'
    );
  });

  test('translates for..in into for..of', () => {
    expect(body('for f in a b; do echo $f; done')).toBe(
      'for (const f of [`a`, `b`]) {\n  await $`echo ${f}`;\n}'
    );
  });

  test('translates case into switch with a default branch', () => {
    const output = body('case "$1" in start) run ;; *) usage ;; esac');
    expect(output).toContain('switch (`${args[0]}`) {');
    expect(output).toContain('case `start`:');
    expect(output).toContain('default:');
    expect(output).toContain('break;');
  });

  test('translates functions into async functions', () => {
    expect(body('greet() { echo "hi $1"; }')).toBe(
      'async function greet(...args) {\n  await $`echo "hi ${args[0]}"`;\n}'
    );
  });

  test('translates assignments, exports and locals', () => {
    expect(body('NAME=value')).toBe('NAME = `value`;');
    expect(body('export PATH_EXTRA=/opt/bin')).toBe(
      'process.env.PATH_EXTRA = `/opt/bin`;'
    );
    expect(body('f() { local x=1; }')).toContain('let x = `1`;');
  });

  test('hoists shell variables so reassignment stays valid JavaScript', () => {
    const { code } = translateShellToMjs('X=1\nX=2', { shebang: false });
    expect(code).toContain('let X;');
    expect(code).toContain('X = `1`;');
    expect(code).toContain('X = `2`;');
  });

  test('translates set -e into shell settings', () => {
    const { code } = translateShellToMjs('set -e', { shebang: false });
    expect(code).toContain("import { $, shell } from 'command-stream';");
    expect(code).toContain('shell.set("e");');
  });

  test('translates command substitution into a captured stdout', () => {
    expect(body('count=$(ls | wc -l)')).toBe(
      'count = `${(await $`ls | wc -l`).stdout.trim()}`;'
    );
  });

  test('translates parameter expansions', () => {
    expect(body('echo "${HOME:-/root}"')).toContain(
      '${process.env.HOME ?? `/root`}'
    );
    expect(body('echo "$#"')).toContain('${args.length}');
    expect(body('echo "$@"')).toContain("${args.join(' ')}");
    expect(body('echo "$$"')).toContain('${process.pid}');
  });

  test('tracks $? only when the script reads it', () => {
    const withStatus = translateShellToMjs('ls\necho $?', { shebang: false });
    expect(withStatus.code).toContain('let exitCode = 0;');
    expect(withStatus.code).toContain('exitCode = (await $`ls`).code;');
    expect(translateShellToMjs('ls', { shebang: false }).code).not.toContain(
      'exitCode'
    );
  });

  test('preserves comments, blank lines and redirects', () => {
    expect(body('# note\n\nls > out.txt 2>&1')).toBe(
      '// note\n\nawait $`ls >out.txt 2>&1`;'
    );
  });

  test('replaces the shell shebang with a node one', () => {
    const { code } = translateShellToMjs('#!/bin/bash\nls');
    expect(code.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(code).not.toContain('/bin/bash');
  });
});

describe('$fy command', () => {
  test('shows usage when given no input', async () => {
    const result = await $`$fy`;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('$fy - Convert shell scripts');
    expect(result.stderr).toContain('Usage:');
  });

  test('shows help on --help', async () => {
    const result = await $`$fy --help`;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  test('translates from stdin', async () => {
    const result = await $({ stdin: 'cd /tmp && pwd' })`$fy`;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("import { $ } from 'command-stream';");
    expect(result.stdout).toContain('if ((await $`cd /tmp`).code === 0) {');
  });

  test('translates a file to stdout and to an output file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fy-'));
    try {
      const input = join(directory, 'in.sh');
      const output = join(directory, 'out.mjs');
      writeFileSync(input, 'echo hello\n');

      const printed = await $`$fy ${input}`;
      expect(printed.code).toBe(0);
      expect(printed.stdout).toContain('await $`echo hello`;');

      const written = await $`$fy ${input} ${output}`;
      expect(written.code).toBe(0);
      expect(readFileSync(output, 'utf8')).toContain('await $`echo hello`;');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('reports a missing input file', async () => {
    const result = await $`$fy /nonexistent/script.sh`;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cannot read');
  });
});

describe('translated scripts run', () => {
  test('a translated script produces the same output as the shell script', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fy-run-'));
    try {
      const script = [
        '#!/bin/sh',
        'GREETING=hello',
        'for name in world there; do',
        '  echo "$GREETING $name"',
        'done',
        'if true; then',
        '  echo yes',
        'fi',
        'echo done | tr a-z A-Z',
      ].join('\n');

      const shellFile = join(directory, 'script.sh');
      const moduleFile = join(directory, 'script.mjs');
      writeFileSync(shellFile, `${script}\n`);

      const { code, diagnostics } = translateShellToMjs(script, {
        // A file URL, not a path: `URL.pathname` yields `/D:/...` on Windows,
        // which is not importable.
        moduleName: new URL('../src/$.mjs', import.meta.url).href,
      });
      expect(diagnostics).toEqual([]);
      writeFileSync(moduleFile, code);

      const fromShell = await $`sh ${shellFile}`;
      const fromModule = await $`bun ${moduleFile}`;
      expect(fromModule.code).toBe(0);
      expect(fromModule.stdout).toBe(fromShell.stdout);
      expect(fromShell.stdout.trim().split('\n')).toEqual([
        'hello world',
        'hello there',
        'yes',
        'DONE',
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('translates a script with CRLF line endings', () => {
    const translated = translateShellToMjs('ls\r\necho hi\r\n', {
      shebang: false,
    });
    expect(translated.diagnostics).toEqual([]);
    expect(translated.body).toBe('await $`ls`;\nawait $`echo hi`;\n');
  });

  test('reproduces the golden fixture shared with the Rust suite', () => {
    // `rust/tests/fy.rs` asserts the same two files, which is what keeps both
    // translators byte-for-byte equivalent. See `fixtures/fy/README.md`.
    const fixture = (name) =>
      readFileSync(
        new URL(`../../fixtures/fy/${name}`, import.meta.url),
        'utf8'
      );

    const translated = translateShellToMjs(fixture('sample.sh'));
    expect(translated.diagnostics).toEqual([]);
    expect(translated.code).toBe(fixture('sample.mjs'));
  });
});
