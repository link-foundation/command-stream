import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import * as nodePath from 'node:path';

const source = readFileSync(
  new URL('../src/shelljs/index.cjs', import.meta.url),
  'utf8'
);

function loadCompat(resolved) {
  const upstream = {};
  const localGlob = { source: 'ShellJS dependency tree' };
  const cdnGlob = { source: 'CDN import' };
  const guarded = [];
  const bases = [];
  const require = (specifier) => {
    if (specifier === 'node:module') {
      return {
        createRequire: (filename) => {
          // Use the real validation: the original implementation throws here.
          createRequire(filename);
          bases.push(filename);
          return (name) => {
            expect(name).toBe('fast-glob');
            return localGlob;
          };
        },
      };
    }
    if (specifier === 'node:path') {
      return nodePath;
    }
    if (specifier === 'fast-glob') {
      return cdnGlob;
    }
    if (specifier === './glob-safety.cjs') {
      return (glob) => guarded.push(glob);
    }
    if (specifier === 'shelljs') {
      // The guard must be installed before exposing ShellJS.
      expect(guarded).toHaveLength(1);
      return upstream;
    }
    throw new Error(`Unexpected require: ${specifier}`);
  };
  require.resolve = () => resolved;
  const module = { exports: {} };
  runInNewContext(source, { require, module });
  return {
    exported: module.exports,
    upstream,
    guarded,
    bases,
    localGlob,
    cdnGlob,
  };
}

test.each(['shelljs', 'https://esm.sh/shelljs@0.10.0'])(
  'ShellJS imports when require.resolve returns %s',
  (resolved) => {
    const result = loadCompat(resolved);
    expect(result.exported).toBe(result.upstream);
    expect(result.guarded).toEqual([result.cdnGlob]);
    expect(result.bases).toEqual([]);
  }
);

test('local installs guard ShellJS own fast-glob even when dependencies are not hoisted', () => {
  const resolved = nodePath.resolve('isolated/shelljs/shell.js');
  const result = loadCompat(resolved);
  expect(result.exported).toBe(result.upstream);
  expect(result.guarded).toEqual([result.localGlob]);
  expect(result.bases).toEqual([resolved]);
});
