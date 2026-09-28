// Keeps the hand-written TypeScript declarations in `types/` complete.
//
// The declarations are compile-time only, so nothing at runtime notices when a
// new export or ProcessRunner member is added without typings. These tests
// compare the declarations against the real module (ESM, CommonJS and the
// `./process-runner` subpath), then type check the whole type test suite and
// the TypeScript examples with `tsc` in strict mode.

import { test, expect, describe } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './commonjs-sandbox.mjs';
import * as esm from '../src/$.mjs';
import * as processRunnerModule from '../src/process-runner.mjs';

const read = (path) =>
  readFileSync(join(PACKAGE_ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const apiDts = read('types/api.d.cts');
const indexDts = read('types/index.d.ts');
const indexDcts = read('types/index.d.cts');
const processRunnerDts = read('types/process-runner.d.ts');
const packageJson = JSON.parse(read('package.json'));

const sorted = (values) => [...new Set(values)].sort();

function declaredValueExports() {
  const names = [
    ...apiDts.matchAll(/^export declare (?:const|function|class) ([\w$]+)/gm),
  ].map((match) => match[1]);
  // The ES module entry re-exports the shared API and adds the default export.
  expect(indexDts).toContain("export * from './api.cjs';");
  if (/^export default \$;$/m.test(indexDts)) {
    names.push('default');
  }
  return sorted(names);
}

function declaredTypeExports(source) {
  return sorted(
    [...source.matchAll(/^export (?:declare )?(?:type|interface) (\w+)/gm)]
      .map((match) => match[1])
      .concat(
        [...source.matchAll(/^export type \{([^}]*)\}/gm)].flatMap((match) =>
          match[1].split(',').map((name) => name.trim())
        )
      )
      .filter(Boolean)
  );
}

function classMembers(source, className) {
  const start = source.search(
    new RegExp(`^(?:export )?declare class ${className}\\b`, 'm')
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}', start);
  const body = source.slice(source.indexOf('{\n', start), end);
  return sorted(
    [
      ...body.matchAll(/^ {2}(?:readonly )?(\w+|\[Symbol\.\w+\])(?=[<(:?])/gm),
    ].map((match) => match[1])
  );
}

function runtimeMembers(Class) {
  const names = Object.getOwnPropertyNames(Class.prototype).map((name) =>
    name === 'constructor' ? 'constructor' : name
  );
  for (const symbol of Object.getOwnPropertySymbols(Class.prototype)) {
    names.push(`[${symbol.description}]`);
  }
  return names.filter((name) => !name.startsWith('_'));
}

describe('TypeScript declarations match the runtime API', () => {
  test('ESM value exports are all declared', () => {
    expect(declaredValueExports()).toEqual(sorted(Object.keys(esm)));
  });

  test('CommonJS exports are all declared', () => {
    const require = createRequire(import.meta.url);
    const cjs = require('../src/$.cjs');
    expect(typeof cjs).toBe('function');
    expect(declaredValueExports()).toEqual(sorted(Object.keys(cjs)));
    expect(cjs.$).toBe(cjs);
  });

  test('./process-runner subpath exports are all declared', () => {
    const declared = [
      ...processRunnerDts.matchAll(/^export \{([^}]*)\}/gm),
    ].flatMap((match) => match[1].split(',').map((name) => name.trim()));
    expect(sorted(declared)).toEqual(sorted(Object.keys(processRunnerModule)));
  });

  test('every public ProcessRunner member is declared', () => {
    const { ProcessRunner } = esm;
    const runner = new ProcessRunner({ mode: 'shell', command: 'true' });
    const ownFields = Object.keys(runner).filter(
      (name) => !name.startsWith('_')
    );
    const inherited = new Set(classMembers(apiDts, 'StreamEmitter'));
    const declared = new Set(classMembers(apiDts, 'ProcessRunner'));
    const missing = sorted([...runtimeMembers(ProcessRunner), ...ownFields])
      .filter((name) => name !== 'listeners')
      .filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
    expect(declared.has('[Symbol.asyncIterator]')).toBe(true);
    expect(ownFields).toContain('listeners');
    expect(inherited.has('listeners')).toBe(true);
  });

  test('every StreamEmitter method is declared', () => {
    const StreamEmitter = Object.getPrototypeOf(esm.ProcessRunner);
    const declared = new Set(classMembers(apiDts, 'StreamEmitter'));
    const missing = runtimeMembers(StreamEmitter).filter(
      (name) => name !== 'constructor' && !declared.has(name)
    );
    expect(missing).toEqual([]);
  });

  test('every exported type is re-exported for CommonJS consumers', () => {
    const cjsTypes = sorted(
      [...indexDcts.matchAll(/^ {2}export type (\w+)/gm)].map(
        (match) => match[1]
      )
    );
    const classes = [...apiDts.matchAll(/^export declare class (\w+)/gm)].map(
      (match) => match[1]
    );
    expect(cjsTypes).toEqual(
      sorted([...declaredTypeExports(apiDts), ...classes])
    );
  });
});

describe('package.json points at the declarations', () => {
  const conditionTargets = (entry) =>
    Object.values(entry).flatMap((value) =>
      typeof value === 'string' ? [value] : conditionTargets(value)
    );

  test('types conditions come first and resolve to files', () => {
    const { exports } = packageJson;
    for (const entry of [
      exports['.'].import,
      exports['.'].require,
      exports['./process-runner'],
    ]) {
      expect(Object.keys(entry)[0]).toBe('types');
      expect(entry.types).toMatch(/\.d\.c?ts$/);
    }
    for (const target of [packageJson.types, ...conditionTargets(exports)]) {
      expect(existsSync(join(PACKAGE_ROOT, target))).toBe(true);
    }
    expect(packageJson.files).toContain('types/');
  });
});

describe('strict type checking', () => {
  test('tsc accepts the declarations, type tests and examples', () => {
    const tsc = join(PACKAGE_ROOT, 'node_modules/typescript/bin/tsc');
    expect(existsSync(tsc)).toBe(true);
    const result = spawnSync(
      process.execPath,
      [tsc, '-p', 'tests/types/tsconfig.json'],
      { cwd: PACKAGE_ROOT, encoding: 'utf8' }
    );
    expect(`${result.stdout}${result.stderr}`).toBe('');
    expect(result.status).toBe(0);
  }, 120000);

  test('type tests cover every value export', () => {
    const typeTests = read('tests/types/esm.types.ts');
    const importList = typeTests.match(
      /import\s+([\w$]+),\s*\{([^}]*)\}\s+from 'command-stream'/
    );
    expect(importList).not.toBeNull();
    const imported = importList[2]
      .split(',')
      .map((name) => name.trim().split(/\s+/)[0])
      .filter((name) => name && name !== 'type');
    expect(sorted([...imported, 'default'])).toEqual(declaredValueExports());
  });
});

describe('TypeScript examples', () => {
  const examples = readdirSync(join(PACKAGE_ROOT, 'examples')).filter((file) =>
    /^typescript-.*\.ts$/.test(file)
  );

  test('there are TypeScript examples', () => {
    expect(examples.length).toBeGreaterThanOrEqual(4);
  });

  for (const example of examples) {
    test(`${example} runs`, () => {
      const result = spawnSync(
        process.execPath,
        [join(PACKAGE_ROOT, 'examples', example)],
        { cwd: PACKAGE_ROOT, encoding: 'utf8', timeout: 60000 }
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    }, 60000);
  }
});

describe('docs/TYPESCRIPT.md Rust mapping', () => {
  const guide = read('docs/TYPESCRIPT.md');
  const mapping = guide.slice(guide.indexOf('## Rust mapping'));
  const rows = mapping
    .split('\n')
    .filter((line) => line.startsWith('| ') && line.includes('`'))
    .map((line) => line.split('|').map((cell) => cell.trim()));
  const names = (cell) =>
    [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

  const rustSource = (function collect(dir) {
    return readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          return collect(path);
        }
        return entry.name.endsWith('.rs') ? readFileSync(path, 'utf8') : '';
      })
      .join('\n');
  })(join(PACKAGE_ROOT, '../rust/src'));

  test('the mapping table has rows', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  test('every TypeScript name in the table is declared', () => {
    const declared = new Set([
      ...declaredValueExports(),
      ...declaredTypeExports(apiDts),
      ...classMembers(apiDts, 'ProcessRunner'),
    ]);
    const missing = rows
      .flatMap(([, , ts]) => names(ts))
      .filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  test('every Rust name in the table exists in rust/src', () => {
    const missing = rows
      .flatMap(([, , , rust]) => names(rust))
      .filter((name) => {
        const macro = name.endsWith('!');
        const ident = name.replace(/!$/, '');
        const pattern = macro
          ? new RegExp(`macro_rules!\\s+${ident}\\b`)
          : new RegExp(
              `pub (?:async )?(?:fn|struct|enum|type|trait) ${ident}\\b|pub use [^;]*\\b${ident}\\b`
            );
        return !pattern.test(rustSource);
      });
    expect(missing).toEqual([]);
  });
});
