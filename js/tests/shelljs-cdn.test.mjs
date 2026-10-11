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
  const bundled = {};
  const imports = [];
  const require = (specifier) => {
    imports.push(specifier);
    if (specifier === './vendor/shell.js') {
      return bundled;
    }
    if (specifier === 'node:module') {
      // Keep real validation so the original CDN loader fails this regression.
      return { createRequire };
    }
    if (specifier === 'node:path') {
      return nodePath;
    }
    throw new Error(`Unexpected require: ${specifier}`);
  };
  require.resolve = () => resolved;
  const module = { exports: {} };
  runInNewContext(source, { require, module });
  return {
    exported: module.exports,
    bundled,
    imports,
  };
}

test.each([
  'shelljs',
  'https://esm.sh/shelljs@0.10.0',
  nodePath.resolve('isolated/shelljs/shell.js'),
])(
  'ShellJS uses bundled commands without filesystem resolution for %s',
  (resolved) => {
    const result = loadCompat(resolved);
    expect(result.exported).toBe(result.bundled);
    expect(result.imports).toEqual(['./vendor/shell.js']);
  }
);
