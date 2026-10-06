import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  packArtifact,
  tempdir,
  runOk,
  writeFiles,
  IT_TIMEOUT,
} from '../zx/fixtures/it/artifact.mjs';

test(
  'published Execa ESM and CommonJS entries work with production dependencies only',
  { timeout: IT_TIMEOUT },
  async () => {
    const packed = await packArtifact();
    const dir = tempdir('cs-execa-consumer-');
    try {
      const parent = path.dirname(packed);
      const tarball = path.join(
        parent,
        fs.readdirSync(parent).find((file) => file.endsWith('.tgz'))
      );
      writeFiles(dir, {
        'package.json': JSON.stringify({ private: true, type: 'module' }),
      });
      await runOk(
        'npm',
        [
          'install',
          tarball,
          '--omit=dev',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ],
        { cwd: dir }
      );
      assert.equal(
        fs.existsSync(path.join(dir, 'node_modules', 'typescript')),
        false
      );
      for (const [name, source] of Object.entries({
        'esm.mjs': `import assert from 'node:assert/strict';
import { execa } from 'command-stream/execa';
import { $ } from 'command-stream';
assert.equal($.execa, execa);
assert.equal((await execa(process.execPath, ['-e', 'process.stdout.write("packed")'])).stdout, 'packed');`,
        'cjs.cjs': `const assert = require('node:assert/strict');
const { execa } = require('command-stream/execa');
const $ = require('command-stream');
assert.equal($.execa, execa);
execa(process.execPath, ['-e', 'process.stdout.write("packed")']).then(result => assert.equal(result.stdout, 'packed'));`,
      })) {
        writeFiles(dir, { [name]: source });
        await runOk(process.execPath, [name], { cwd: dir });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
