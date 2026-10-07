// Reproduce issue #213 under Node or Bun; stderr should remain empty.
import {
  $,
  ProcessRunner,
  resetGlobalState,
  set,
  unset,
} from '../../js/src/$.mjs';

const observations = [];
async function probe(label, run) {
  try {
    const result = await run();
    observations.push({
      label,
      rejected: false,
      code: result.code,
      stderr: result.stderr?.toString(),
    });
  } catch (error) {
    observations.push({
      label,
      rejected: true,
      code: error.code,
      stderr: error.result?.stderr ?? error.stderr,
    });
  }
}

resetGlobalState();
try {
  set('e');
  await probe('virtual exit 7, mirror default', () => $`exit 7`);
  await probe(
    'virtual exit 7, mirror false',
    () => $({ mirror: false })`exit 7`
  );
  await probe(
    'virtual exit 7, capture false',
    () => $({ capture: false })`exit 7`
  );
  await probe(
    'real process exit 7',
    () =>
      new ProcessRunner({
        mode: 'exec',
        file: process.execPath,
        args: ['-e', 'process.exit(7)'],
      })
  );
  await probe('virtual exit 0 under set -e', () => $`exit 0`);
  await probe('virtual default exit under set -e', () => $`exit`);
  await probe('exit 3 sequence under set -e', () => $`exit 3; echo after`);
  unset('e');
  await probe('virtual exit 0', () => $`exit 0`);
  await probe('virtual exit 7 without errexit', () => $`exit 7`);
} finally {
  resetGlobalState();
}
console.log(JSON.stringify(observations, null, 2));
