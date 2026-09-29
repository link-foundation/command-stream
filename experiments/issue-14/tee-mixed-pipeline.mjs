// Probe: virtual command followed by a real process in a shell pipeline (issue #14)
import { $ } from '../../js/src/$.mjs';

const cases = [
  'echo hello | tr a-z A-Z',
  'echo hello | tee /tmp/tee-probe-1.txt | tr a-z A-Z',
  'echo hello | cat | tr a-z A-Z',
  'echo hello | tee /tmp/tee-probe-2.txt | cat',
  'echo hello | tee /tmp/tee-probe-3.txt',
];

for (const cmd of cases) {
  const result = await $({ mirror: false })`${{ raw: cmd }}`;
  console.log(
    cmd,
    '=>',
    JSON.stringify({
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    })
  );
}
