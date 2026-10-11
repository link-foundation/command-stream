// Run with the old checkout or the isolated API module as the sole argument.
// A finite child is used so the probe cannot leave a long-running subprocess.
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { execa } = await import(pathToFileURL(process.argv[2]).href);
const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
const values = ['', 'a b', 'a"b', "a'b", '$HOME', 'semi;colon', 'line\nbreak'];
let failures = 0;
try {
  const result = await execa(process.execPath, ['-e', script, '--', ...values]);
  assert.deepEqual(JSON.parse(result.stdout), values);
  console.log('exact argv: PASS');
} catch (error) {
  failures++;
  console.log('exact argv: FAIL', error.message);
}
const subprocess = execa(process.execPath, ['-e', 'console.log("done")']);
try {
  assert.equal(typeof subprocess.kill, 'function');
  assert.ok(subprocess.stdout);
  console.log('live subprocess: PASS');
} catch (error) {
  failures++;
  console.log('live subprocess: FAIL', error.message);
}
try {
  await subprocess;
} catch (error) {
  failures++;
  console.log('subprocess completion: FAIL', error.message);
}
try {
  const result = await execa(
    process.execPath,
    [fileURLToPath(new URL('./stdin-fixture.mjs', import.meta.url))],
    { input: 'input reaches child' }
  );
  assert.equal(result.stdout, 'input reaches child');
  console.log('stdin input: PASS');
} catch (error) {
  failures++;
  console.log('stdin input: FAIL', error.message);
}
process.exitCode = failures ? 1 : 0;
