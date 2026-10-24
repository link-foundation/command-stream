import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateSource } from '../src/fy/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimes = ['node', 'bun'].filter(
  (runtime) => spawnSync(runtime, ['--version']).status === 0
);

describe('competitor source migration', () => {
  test('infers only a supported first-line interpreter with bounded whitespace handling', () => {
    for (const header of ['#!/bin/bash', '#!/usr/bin/env\tbash']) {
      expect(translateSource(`${header}\nprintf ok`).code).toContain(
        'command("bash",'
      );
    }
    for (const source of [
      'printf ok\n#!/bin/bash',
      `#!${'\t'.repeat(16384)}unknown\nprintf ok`,
    ]) {
      expect(translateSource(source).code).toContain('command("sh",');
    }
  });
  test('preserves literal braces in custom module names', () => {
    const result = translateSource('import x from "zx";', {
      from: 'javascript',
      moduleName: './{local}',
    });
    expect(result.code).toBe('import x from "./{local}/zx";');
    expect(result.diagnostics).toEqual([]);
  });
  test('matches the shared default shell program fixture', () => {
    const source = readFileSync(
      new URL('../../fixtures/fy/sample.sh', import.meta.url),
      'utf8'
    );
    const expected = readFileSync(
      new URL('../../fixtures/fy/sample-program.mjs', import.meta.url),
      'utf8'
    );
    expect(translateSource(source).code).toBe(expected);
  });
  test('migrates every advertised competitor through syntax nodes and rules', () => {
    const source = readFileSync(
      new URL('../../fixtures/fy/competitors.js', import.meta.url),
      'utf8'
    );
    const expected = readFileSync(
      new URL('../../fixtures/fy/competitors.mjs', import.meta.url),
      'utf8'
    );
    const translated = translateSource(source, { from: 'javascript' });
    expect(translated.code).toBe(expected);
    expect(translated.diagnostics).toEqual([]);
    expect(translated.network).toBeDefined();
    expect(translated.ruleSet.rules.length).toBeGreaterThan(4);
  });

  test('ignores comments, strings, regexes and property methods; visits template expressions', () => {
    const source =
      '// import x from "zx"\nconst s = "require(\'execa\')";\nconst re = /require("zx")/;\nobj.require("zx");\nconst t = `${(await import("zx")).VERSION}`;';
    const { code } = translateSource(source, { from: 'javascript' });
    expect(code).toContain('// import x from "zx"');
    expect(code).toContain('obj.require("zx")');
    expect(code).toContain('/require("zx")/');
    expect(code).toContain('import("command-stream/zx")');
  });

  test('rejects unknown source languages and invalid JavaScript without emitting broken output', () => {
    expect(() => translateSource('echo hi', { from: 'unknown' })).toThrow();
    expect(() => translateSource('import {', { from: 'javascript' })).toThrow();
  });

  test('leaves locally bound require and unrelated module names intact', () => {
    const source =
      'function local(require) { return require("zx"); }\nimport x from "toString"; import y from "__proto__";';
    const result = translateSource(source, { from: 'javascript' });
    expect(result.code).toBe(source);
    expect(result.diagnostics.join('\n')).toContain('locally bound require');
  });

  test('decodes escaped module specifiers and honors CommonJS filename detection', () => {
    const result = translateSource(
      String.raw`const sh = require('shell\x6as');`,
      { filename: 'source.cjs' }
    );
    expect(result.code).toContain('require("command-stream/shelljs")');
    expect(result.code).toContain('export default __fyModule.exports');
  });

  const print = JSON.stringify('process.stdout.write("migrated")');
  for (const [from, source] of [
    [
      'zx',
      'import { $ } from "zx"; console.log((await $`printf migrated`).text());',
    ],
    [
      'execa',
      `import { execa } from "execa"; console.log((await execa(process.execPath, ["-e", ${print}])).stdout);`,
    ],
    [
      'shelljs',
      'import sh from "shelljs"; console.log(sh.exec("printf migrated", {silent:true}).stdout);',
    ],
    [
      'bun',
      'import { $ } from "bun"; console.log(await $`printf migrated`.text());',
    ],
    [
      'cross-spawn',
      `import spawn from "cross-spawn"; console.log(spawn.sync(process.execPath, ["-e", ${print}], {encoding:"utf8"}).stdout);`,
    ],
  ]) {
    test(`runs migrated ${from} source in Node and Bun`, () => {
      const dir = mkdtempSync(join(root, '.fy-test-'));
      try {
        const file = join(dir, 'translated.mjs');
        writeFileSync(file, translateSource(source, { from }).code);
        for (const runtime of runtimes) {
          expect(
            execFileSync(runtime, [file], { encoding: 'utf8' }).trim()
          ).toBe('migrated');
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test('CommonJS migration produces an executable ES module', () => {
    const dir = mkdtempSync(join(root, '.fy-test-'));
    try {
      const file = join(dir, 'translated.mjs');
      const code = translateSource(
        readFileSync(
          new URL('../../fixtures/fy/commonjs.cjs', import.meta.url),
          'utf8'
        ),
        { from: 'shelljs', commonjs: true }
      ).code;
      expect(code).toBe(
        readFileSync(
          new URL('../../fixtures/fy/commonjs.mjs', import.meta.url),
          'utf8'
        )
      );
      writeFileSync(file, code);
      for (const runtime of runtimes) {
        expect(execFileSync(runtime, [file], { encoding: 'utf8' }).trim()).toBe(
          'migrated'
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('automatic shell translation preserves functions, glob case, stdin, arguments and status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fy-lossless-'));
  try {
    const source =
      'cat\ngreet() { printf "%s\\n" "$1"; }\ngreet "$1"\ncase "$1" in a*) echo match;; esac\nexit 7\n';
    const file = join(dir, 'translated.mjs');
    const translation = translateSource(source, {
      moduleName: new URL('../src/$.mjs', import.meta.url).href,
      useM: false,
    });
    writeFileSync(file, translation.code);
    const expected = spawnSync(
      'sh',
      ['-c', source, 'translated.sh', 'alpha beta'],
      { input: 'stdin\n', encoding: 'utf8' }
    );
    for (const runtime of runtimes) {
      const actual = spawnSync(runtime, [file, 'alpha beta'], {
        input: 'stdin\n',
        encoding: 'utf8',
      });
      expect({
        stdout: actual.stdout,
        stderr: actual.stderr,
        status: actual.status,
      }).toEqual({
        stdout: expected.stdout,
        stderr: expected.stderr,
        status: expected.status,
      });
    }
    expect(translateSource(source).code).toContain("from 'use-m'");
    expect(translateSource(source).code).toContain(
      'await use("command-stream")'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generated shell module actually loads command-stream through use-m', () => {
  const dir = mkdtempSync(join(root, '.fy-test-'));
  try {
    const file = join(dir, 'translated.mjs');
    writeFileSync(
      file,
      translateSource('printf "%s" "$1"', { moduleName: '../src/$.mjs' }).code
    );
    for (const runtime of runtimes) {
      expect(
        execFileSync(runtime, [file, 'use-m works'], { encoding: 'utf8' })
      ).toBe('use-m works');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both JavaScript CLI entry points migrate stdin and refuse to overwrite output', () => {
  const dir = mkdtempSync(join(root, '.fy-test-'));
  try {
    const source = 'import { $ } from "zx";';
    const input = join(dir, 'input.mjs');
    const output = join(dir, 'output.mjs');
    writeFileSync(input, source);
    for (const entry of ['fy-cli.mjs', 'cli.mjs']) {
      const args = [
        fileURLToPath(new URL(`../src/${entry}`, import.meta.url)),
        ...(entry === 'cli.mjs' ? ['fy'] : []),
      ];
      const translated = execFileSync('node', [...args, '--from', 'zx', '-'], {
        input: source,
        encoding: 'utf8',
      });
      expect(translated).toBe(translateSource(source, { from: 'zx' }).code);
      expect(spawnSync('node', [...args, input, output]).status).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe(translated);
      expect(spawnSync('node', [...args, input, output]).status).toBe(1);
      expect(readFileSync(output, 'utf8')).toBe(translated);
      rmSync(output);
      expect(spawnSync('node', [...args, '--unknown']).status).toBe(1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell file translation retains the original script basename', () => {
  const dir = mkdtempSync(join(root, '.fy-test-'));
  try {
    const input = join(dir, 'original.sh');
    const output = join(dir, 'translated.mjs');
    writeFileSync(input, 'printf "%s" "$0"');
    execFileSync('node', [
      fileURLToPath(new URL('../src/fy-cli.mjs', import.meta.url)),
      '--no-use-m',
      '--module',
      new URL('../src/$.mjs', import.meta.url).href,
      input,
      output,
    ]);
    expect(execFileSync('node', [output], { encoding: 'utf8' })).toBe(
      'original.sh'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
