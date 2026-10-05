// Port of zx test/it/build-jsr.test.js (issue #26). Test vectors come from
// google/zx (Apache-2.0) at the pinned corpus commit.
//
// Upstream generates a jsr.json for its TypeScript sources and runs
// `jsr publish --dry-run`. The JSR CLI is Deno's publisher, so the port stages
// the zx-compatible layer with a generated jsr.json in a temp dir and runs
// `deno publish --dry-run`, which validates the manifest, the export targets
// and every module graph offline.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { which } from '../../src/zx/index.mjs';
import {
  IT_TIMEOUT,
  ROOT,
  runOk,
  tempdir,
  writeFiles,
} from './fixtures/it/artifact.mjs';

const deno = which.sync('deno', { nothrow: true });

describe(
  'jsr artifact',
  { skip: deno ? false : 'deno is not installed' },
  () => {
    let tmp;

    before(() => {
      tmp = tempdir();
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
      );
      fs.cpSync(path.join(ROOT, 'src/zx'), path.join(tmp, 'src/zx'), {
        recursive: true,
      });
      fs.copyFileSync(
        path.join(ROOT, 'src/$.local-bin.mjs'),
        path.join(tmp, 'src/$.local-bin.mjs')
      );
      fs.copyFileSync(
        path.join(ROOT, 'README.md'),
        path.join(tmp, 'README.md')
      );
      writeFiles(tmp, {
        'jsr.json': JSON.stringify(
          {
            name: '@link-foundation/command-stream',
            version: pkgJson.version,
            license: pkgJson.license,
            exports: {
              '.': './src/zx/index.mjs',
              './core': './src/zx/core.mjs',
              './cli': './src/zx/cli.mjs',
              './globals': './src/zx/globals.mjs',
            },
            publish: { include: ['src', 'README.md'] },
          },
          null,
          2
        ),
      });
    });
    after(() => fs.rmSync(tmp, { recursive: true, force: true }));

    test(
      '[zx:test/it/build-jsr.test.js:49:3:registration] publish --dry-run`',
      { timeout: IT_TIMEOUT },
      async () => {
        const out = await runOk(
          deno,
          ['publish', '--dry-run', '--allow-dirty', '--no-check'],
          { cwd: tmp, env: { DENO_NO_PACKAGE_JSON: '1' } }
        );
        // Deno colors its report even when stdout is not a TTY.
        const report = out.all.replace(/\u001B\[[\d;]*m/g, '');
        assert.match(report, /Success Dry run complete/);
        assert.match(report, /src\/zx\/core\.mjs/);
      }
    );
  }
);
