import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// These five files emitted warnings in the successful issue-time Rust run.
// Keep room for concurrent PRs instead of silencing or raising the threshold.
for (const file of [
  'rust/scripts/version-and-commit.rs',
  'rust/src/lib.rs',
  'rust/src/bun_shell/lexer.rs',
  'rust/src/bun_shell/io.rs',
  'rust/src/bun_shell/builtins/small.rs',
]) {
  test(`issue #209: ${file} stays below the Rust warning threshold`, () => {
    const content = readFileSync(
      resolve(import.meta.dir, '../../', file),
      'utf8'
    );
    expect(content.trimEnd().split('\n').length).toBeLessThanOrEqual(900);
  });
}
