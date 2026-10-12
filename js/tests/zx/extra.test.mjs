// Port of zx test/extra.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.
//
// Upstream asserts that every source file carries zx's Apache license header.
// command-stream is Unlicense, so the port keeps the intent - every module of
// the zx-compatible layer starts with a header comment that says what it is -
// and runs the same globby query over js/src/zx.

import assert from 'node:assert';
import { test, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { globby, fs, path } from '../../src/zx/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZX_SRC = path.resolve(__dirname, '../../src/zx');
// `\r?`: Windows checkouts have CRLF line endings.
const HEADER = /^(#!.*\r?\n)?\/\/ \S.*\r?\n/;

describe('extra', () => {
  test('[zx:test/extra.test.js:22:3:registration] every file should have a license', async () => {
    const files = await globby(
      ['**/*.{js,mjs,cjs,ts}', '!**/*polyfill.js', '!build'],
      {
        gitignore: true,
        onlyFiles: true,
        cwd: ZX_SRC,
        followSymbolicLinks: false,
      }
    );
    assert.ok(files.length > 20, `too few files found: ${files.length}`);
    for (const file of files) {
      const content = await fs.readFile(path.join(ZX_SRC, file), 'utf8');
      assert.match(content, HEADER, `No header comment in ${file}.`);
    }
  });
});
