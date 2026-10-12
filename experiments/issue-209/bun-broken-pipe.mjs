// Finite upstream reproduction: one 850 KB file, 50 sequential shell runs.
import { $ } from 'bun';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-broken-pipe-'));
let failures = 0;
try {
  const input = path.join(dir, 'input.txt');
  fs.writeFileSync(input, 'this line says hi\n'.repeat(50_000));
  for (let attempt = 1; attempt <= 50; attempt++) {
    const result = await $`grep hi ${input} | echo hi`.quiet().nothrow();
    if (
      result.exitCode !== 0 ||
      result.stdout.toString() !== 'hi\n' ||
      result.stderr.length !== 0
    ) {
      failures++;
      console.error(
        JSON.stringify({
          attempt,
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        })
      );
    }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(
  `Bun ${Bun.version} on ${process.platform}: ${failures}/50 failures`
);
process.exitCode = failures ? 1 : 0;
