## Problem

Bun 1.4.2 intermittently sends GNU grep's `write error: Connection reset by peer` to captured stderr for `grep hi <large-file> | echo hi`. The pipeline still returns exit code 0 and `hi\n` on stdout. Bun's own current `test/js/bun/shell/bunshell.test.ts` broken pipe subproc case expects empty stderr.

Observed on Linux x86_64, kernel 6.8.0-142-generic, GNU grep 3.11. The same case passed in other executions, so a single successful run does not disprove the problem.

## Reproduction and evidence

In https://github.com/link-foundation/command-stream at commit 65639ea75304f32fbf1d2d4ae72037798fd5c60e:

```sh
bun conformance/bun-shell/run-bun-reference.mjs --filter deno-broken-pipe-subproc --concurrency 1 --verbose
```

Repeat this command 20 times. The case generates a finite 850 KB file containing 50,000 `this line says hi` lines, then executes `grep hi src/js_parser/parser.rs | echo hi` through Bun.$. In our 20 isolated executions, one failed with:

```text
stderr: expected "", got "/usr/bin/grep: write error: Connection reset by peer\n"
```

The same failure occurred in CI https://github.com/link-foundation/command-stream/actions/runs/37358951220/job/111928398148 (2026-10-05 18:50:47 UTC). The other 1,215 Linux reference cases passed; all command-stream implementations passed this case on their first attempts.

Minimal standalone equivalent:

```js
import { $ } from 'bun';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-pipe-'));
try {
  const input = path.join(dir, 'input.txt');
  fs.writeFileSync(input, 'this line says hi\n'.repeat(50_000));
  for (let i = 0; i < 50; i++) {
    const out = await $`grep hi ${input} | echo hi`.quiet().nothrow();
    console.log(i, out.exitCode, JSON.stringify(out.stdout.toString()), JSON.stringify(out.stderr.toString()));
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
```

All 50 standalone executions in our first probe passed; the existing corpus reproduction and actual CI failure above establish the intermittent defect. Scheduling/context appears to matter; the exact internal race remains unproven.

## Workaround

Retain exit-code/stdout/stderr assertions, but allow at most three additional attempts for this specific Bun reference case. Keep implementations strict on their first attempt. Print attempt details with existing verbose/trace options. This is a bounded temporary workaround, not removal of stderr validation or a general retry for product tests.

## Suggested code investigation/fix

Trace shell pipeline endpoint creation/closure and the child write failure when the downstream builtin finishes early. Check whether Unix socket closure with unread data produces ECONNRESET where a pipe/SIGPIPE would terminate grep without its stderr diagnostic. Preserve the normal pipeline exit status; add a repeatedly scheduled regression around the current broken pipe subproc test and ensure child endpoints are closed/drained consistently. The socket explanation is an investigation hypothesis, not a confirmed source-level diagnosis.

Full logs and reusable probes are being archived in https://github.com/link-foundation/command-stream/pull/210 under `dev/log/issues/209/pulls/210/validation/` and `experiments/issue-209/`.
