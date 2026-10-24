// Child half of the "outlives the caller" test (issue #232): detach a delayed
// write, print its pid and exit without waiting for it.
import { spawnDetached } from '../../src/$.mjs';

const [dir] = process.argv.slice(2);
const script =
  "setTimeout(() => require('fs').writeFileSync('alive', 'alive\\n'), 500)";
const { pid } = await spawnDetached([process.execPath, '-e', script], {
  cwd: dir,
});
process.stdout.write(`${pid}\n`);
