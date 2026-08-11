// Regression tests for the CommonJS entry point (issue #189).
//
// The package used to export only `./src/$.mjs`, so a CommonJS host could only
// reach the library through `await import('command-stream')`. That is
// asynchronous, which made the synchronous `ProcessRunner.sync()` API unusable
// at a synchronous launch-time probe boundary.
//
// `./src/$.cjs` is now published under the "require" export condition. These
// tests pin the resolved shape (callable `$` with named exports attached), that
// `.sync()` really runs synchronously from `require()`, and that require/import
// keep sharing a single module instance (no dual-package hazard).

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  PACKAGE_ROOT,
  createCommonJsSandbox,
  detectNodeVersion,
  removeCommonJsSandbox,
  runSandboxScript,
  supportsRequireEsm,
} from './commonjs-sandbox.mjs';

const PACKAGE_JSON = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
);

let sandbox = null;
let nodeVersion = null;

/** Whether the node executable on PATH can run the bare-specifier probes. */
function canProbeWithNode() {
  if (!nodeVersion) {
    console.log('Skipping: node executable is not available');
    return false;
  }
  if (!supportsRequireEsm(nodeVersion)) {
    console.log(`Skipping: node ${nodeVersion} has no require(esm) support`);
    return false;
  }
  return true;
}

beforeAll(() => {
  nodeVersion = detectNodeVersion();
  sandbox = createCommonJsSandbox();
});

afterAll(() => {
  removeCommonJsSandbox(sandbox);
});

describe('CommonJS entry point (issue #189)', () => {
  describe('package manifest', () => {
    test('declares a require condition pointing at the CommonJS entry', () => {
      expect(PACKAGE_JSON.exports['.'].require).toBe('./src/$.cjs');
      expect(PACKAGE_JSON.exports['.'].import).toBe('./src/$.mjs');
      expect(PACKAGE_JSON.main).toBe('./src/$.cjs');
      expect(PACKAGE_JSON.module).toBe('./src/$.mjs');
    });

    test('ships the CommonJS entry inside the published files', () => {
      expect(PACKAGE_JSON.files).toContain('src/');
      expect(() =>
        readFileSync(join(PACKAGE_ROOT, 'src', '$.cjs'), 'utf8')
      ).not.toThrow();
    });
  });

  describe('in-process require()', () => {
    const require = createRequire(import.meta.url);

    test('exports a callable $ with the named exports attached', () => {
      const $ = require('../src/$.cjs');

      expect(typeof $).toBe('function');
      expect($.$).toBe($);
      expect($.default).toBe($);
      expect($.__esModule).toBe(true);
      for (const name of ['sh', 'exec', 'run', 'quote', 'create', 'register']) {
        expect(typeof $[name]).toBe('function');
      }
      expect(typeof $.ProcessRunner).toBe('function');
      expect(typeof $.shell).toBe('object');
    });

    test('runs ProcessRunner.sync() synchronously', () => {
      const $ = require('../src/$.cjs');
      const result = $({ mirror: false })`echo cjs-sync`.sync();

      expect(result.stdout.trim()).toBe('cjs-sync');
      expect(result.code).toBe(0);
    });

    test('shares one module instance with the ESM entry point', async () => {
      const $ = require('../src/$.cjs');
      const esm = await import('../src/$.mjs');

      expect($.ProcessRunner).toBe(esm.ProcessRunner);
      expect($.shell).toBe(esm.shell);
      expect($({ mirror: false })`echo instance`).toBeInstanceOf(
        esm.ProcessRunner
      );
    });

    test('does not mutate the $ function seen by ESM consumers', async () => {
      const $ = require('../src/$.cjs');
      const esm = await import('../src/$.mjs');

      expect($).not.toBe(esm.$);
      expect(esm.$.sh).toBeUndefined();
      expect(esm.$.ProcessRunner).toBeUndefined();
    });
  });

  describe('resolution from a CommonJS host', () => {
    test('require("command-stream") resolves and runs .sync()', () => {
      if (!canProbeWithNode()) {
        return;
      }

      const result = runSandboxScript(sandbox, 'probe.cjs', [
        "const $ = require('command-stream');",
        "if (typeof $ !== 'function') {",
        "  throw new Error('expected require() to return a callable $');",
        '}',
        'const probe = $({ mirror: false })`echo launch-probe`.sync();',
        'console.log(',
        '  JSON.stringify({',
        '    stdout: probe.stdout.trim(),',
        '    code: probe.code,',
        '    sh: typeof $.sh,',
        '  })',
        ');',
      ]);

      // stderr is not required to be empty: Node.js 20 and 22 print an
      // ExperimentalWarning when require() loads an ES module.
      expect(result.stderr).not.toContain('ERR_REQUIRE_ESM');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        stdout: 'launch-probe',
        code: 0,
        sh: 'function',
      });
    });

    test('destructuring named exports works from require()', () => {
      if (!canProbeWithNode()) {
        return;
      }

      const result = runSandboxScript(sandbox, 'named.cjs', [
        "const { $, sh, ProcessRunner, shell } = require('command-stream');",
        'const runner = $({ mirror: false })`echo named-exports`;',
        'const probe = runner.sync();',
        'console.log(',
        '  JSON.stringify({',
        '    stdout: probe.stdout.trim(),',
        '    isRunner: runner instanceof ProcessRunner,',
        '    sh: typeof sh,',
        '    settings: typeof shell.settings(),',
        '  })',
        ');',
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        stdout: 'named-exports',
        isRunner: true,
        sh: 'function',
        settings: 'object',
      });
    });

    test('require() and import() return the same module instance', () => {
      if (!canProbeWithNode()) {
        return;
      }

      const result = runSandboxScript(sandbox, 'instance.cjs', [
        "const $ = require('command-stream');",
        "import('command-stream').then((esm) => {",
        '  console.log(',
        '    JSON.stringify({',
        '      sameRunner: esm.ProcessRunner === $.ProcessRunner,',
        '      sameShell: esm.shell === $.shell,',
        '    })',
        '  );',
        '});',
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        sameRunner: true,
        sameShell: true,
      });
    });
  });
});
