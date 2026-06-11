// Reproduce issue #170 via the REAL trigger: a spurious 'close' event on the
// parent stdout stream while an errexit command is in flight and being awaited.
//
// On Windows/Bun the parent WriteStream can emit 'close' spuriously (this is also
// why the run logged "11 close listeners added to [WriteStream]"). That fires
// monitorParentStreams' listener -> _handleParentStreamClosure() on every active
// runner, which aborts/kills the live command. If that replaces the real exit
// code (5) with a synthetic SIGTERM (143), the errexit error is wrong.
import { $, shell } from "../js/src/$.mjs";

shell.errexit(true);

// Fire a spurious 'close' on process.stdout shortly after the command starts.
setTimeout(() => {
  console.error(">>> emitting spurious close on process.stdout");
  process.stdout.emit("close");
}, 60);

let code, stderr, stdout, threw;
try {
  const result =
    await $`sh -c "echo stdout-marker; echo stderr-marker >&2; sleep 0.25; exit 5"`;
  code = result.code;
  stdout = result.stdout;
  stderr = result.stderr;
} catch (error) {
  threw = true;
  code = error.code;
  stdout = error.stdout;
  stderr = error.stderr;
}

console.error(
  `RESULT threw=${threw} code=${code} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
);
if (code === 5) {
  console.error("PASS: real exit code 5 preserved");
  process.exit(0);
} else {
  console.error(
    `FAIL: expected code 5, got ${code} (synthetic SIGTERM means the bug reproduced)`,
  );
  process.exit(1);
}
