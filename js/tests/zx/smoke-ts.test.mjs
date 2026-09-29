// Port of zx test/smoke/ts.test.ts (issue #26). Test vectors come from
// google/zx (Apache-2.0) at the pinned corpus commit.
//
// The TypeScript script (tests/zx/fixtures/smoke/ts.ts) is type-checked by
// `npm run check:types` and executed here: Bun and Node >= 22.18 run .ts
// natively, Node 22.6+ behind --experimental-strip-types; older Node versions
// run it after stripping the types with esbuild (TypeScript 7 ships no JS
// transpile API).

import assert from 'node:assert';
import fs from 'node:fs';
import { test, describe } from 'node:test';
import { runFixture, smokeFixture } from './fixtures/smoke/run.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const isBun = Boolean(process.versions.bun);
const native = isBun || major > 22 || (major === 22 && minor >= 18);
const stripFlag = !native && major === 22 && minor >= 6;

async function runTs(file) {
  if (native || stripFlag) {
    return runFixture(file, {
      args: stripFlag ? ['--experimental-strip-types', '--no-warnings'] : [],
    });
  }
  const { transformSync } = await import('esbuild');
  const { code: outputText } = transformSync(fs.readFileSync(file, 'utf8'), {
    loader: 'ts',
    format: 'esm',
  });
  // Written next to the fixture so `command-stream/zx/globals` resolves.
  const out = file.replace(/\.ts$/, '.transpiled.mjs');
  fs.writeFileSync(out, outputText);
  try {
    return await runFixture(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

describe('smoke: ts', () => {
  test('[zx:test/smoke/ts.test.ts:1:1:file] typed globals entry', async () => {
    const { code, stdout, stderr } = await runTs(smokeFixture('ts.ts'));
    assert.equal(code, 0, stderr);
    assert.match(stdout, /smoke ts: ok/);
  });
});
