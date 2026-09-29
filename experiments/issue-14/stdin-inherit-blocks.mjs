// Reproduces the Windows/macOS CI failure seen on PR #130 (issue #14).
//
// `bun test` evaluates js/tests/test-helper.mjs only once, so its reset hooks
// belong to whichever test file imported it first. A file such as
// js/tests/raw-function.test.mjs can therefore leave virtual commands disabled
// for every file that runs afterwards, and bun's file order is neither
// alphabetical nor stable across platforms, which is why only macOS and Windows
// failed while Linux passed.
//
// With virtual commands disabled, `cat` is a real binary, and a real command
// run with `stdin: 'inherit'` never finishes: the runner pumps the parent's
// stdin into a pipe and the child keeps waiting for an EOF that never arrives.
// That hang is pre-existing behaviour, reproducible on `main` under both Bun
// and Node, and it happens even when the parent's stdin is /dev/null.
//
//   bun experiments/issue-14/stdin-inherit-blocks.mjs < /dev/null
//   node experiments/issue-14/stdin-inherit-blocks.mjs < /dev/null
//
// Expected output: "blocked: no result after 5000ms".
//
// js/tests/virtual-command-stdin.test.mjs therefore enables virtual commands
// itself instead of trusting the state left behind by other files.
import { $, disableVirtualCommands } from '../../js/src/$.mjs';

const TIMEOUT_MS = 5000;

disableVirtualCommands(); // simulates the state leaked by an earlier test file

const blocked = Symbol('blocked');
const outcome = await Promise.race([
  $({ mirror: false, stdin: 'inherit' })`cat`,
  new Promise((resolve) => setTimeout(() => resolve(blocked), TIMEOUT_MS)),
]);

if (outcome === blocked) {
  console.log(`blocked: no result after ${TIMEOUT_MS}ms`);
  process.exit(1);
}

console.log(`completed: code=${outcome.code}`);
