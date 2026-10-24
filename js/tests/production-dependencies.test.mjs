import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const lock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
);

describe('production dependency contract (issue #221)', () => {
  test('ShellJS compatibility and declarations do not install upstream runtime chains', () => {
    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      expect(manifest[section]?.shelljs).toBeUndefined();
      expect(manifest[section]?.['@types/shelljs']).toBeUndefined();
    }
  });

  test('the consumer lockfile excludes the vulnerable braces chain', () => {
    const forbidden = [
      'shelljs',
      '@types/shelljs',
      'fast-glob',
      'micromatch',
      'braces',
    ];
    const production = Object.entries(lock.packages).filter(
      ([name, entry]) => name && !entry.dev
    );
    for (const [name] of production) {
      for (const dependency of forbidden) {
        expect(
          name.endsWith(`/node_modules/${dependency}`) ||
            name === `node_modules/${dependency}`
        ).toBe(false);
      }
    }
  });

  test('ShellJS declarations resolve bundled types without upstream packages', () => {
    const declarations = readFileSync(
      new URL('../types/shelljs.d.cts', import.meta.url),
      'utf8'
    );
    expect(declarations).not.toContain("require('shelljs')");
  });
});
