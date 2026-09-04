// Reproduces issue #170: resetGlobalState() firing while a command is still
// in-flight and being awaited must NOT replace the real exit code with a
// synthetic SIGTERM (143) result.
//
// The CI failure on Windows/Bun was: `await $`sh -c "...; exit 5"`` reported
// code 143 / stderr "Process killed with SIGTERM" instead of code 5, because
// the global test-isolation reaper (cleanupActiveRunners) killed the live
// command mid-flight.
import { $, resetGlobalState } from '../js/src/$.mjs';

async function run() {
  // Schedule a global reset to fire while the command below is still running,
  // emulating the Windows/Bun timing where a test hook's resetGlobalState()
  // races a command that is still being awaited.
  setTimeout(() => {
    console.error('>>> firing resetGlobalState() mid-command');
    resetGlobalState();
  }, 100);

  let code, stderr, threw;
  try {
    const result = await $`sh -c "echo stdout-marker; echo stderr-marker >&2; sleep 0.3; exit 5"`;
    code = result.code;
    stderr = result.stderr;
  } catch (error) {
    threw = true;
    code = error.code;
    stderr = error.stderr;
  }

  console.error(`RESULT threw=${threw} code=${code} stderr=${JSON.stringify(stderr)}`);
  if (code === 5) {
    console.error('PASS: real exit code 5 preserved');
    process.exit(0);
  } else {
    console.error(`FAIL: expected code 5, got ${code}`);
    process.exit(1);
  }
}

run();
