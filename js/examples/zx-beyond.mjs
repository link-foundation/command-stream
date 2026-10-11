#!/usr/bin/env node
// A zx script that keeps working under command-stream and then uses what zx
// has no equivalent for: typed stdout/stderr chunks in one loop, JavaScript
// functions as shell commands inside pipelines, and built-in commands that
// need no system binaries.
//
//   node js/examples/zx-beyond.mjs
import { $, register, unregister } from '../src/$.mjs';

// 1. Unchanged zx code runs through the zx compatibility mode.
const branch = await $.zx`echo main`;
console.log(`zx: ${branch.stdout.trim()} (exit ${branch.exitCode})`);

// 2. One loop sees both streams and the exit code, tagged, as the chunks
//    arrive. zx iterates stdout lines only; stderr needs a separate listener.
for await (const chunk of $({
  mirror: false,
})`sh -c 'echo out; echo err >&2'`.stream()) {
  console.log(
    chunk.type === 'exit'
      ? `exit: ${chunk.code}`
      : `${chunk.type}: ${chunk.data.toString().trim()}`
  );
}

// 3. A JavaScript function registered as a command runs inside a shell
//    pipeline, between the built-in `echo` and the system `sort`.
register('shout', async ({ stdin }) => ({
  stdout: String(stdin).toUpperCase(),
}));
try {
  const piped = await $({ mirror: false })`echo b a | shout | sort`;
  console.log(`virtual command in a pipeline: ${JSON.stringify(piped.stdout)}`);
} finally {
  unregister('shout');
}

// 4. `seq`, `cat`, `mkdir`, `ls`, `rm` ... are built in, so the same script
//    runs on Windows without Git Bash or coreutils.
const listing = await $({
  mirror: false,
})`mkdir -p zx-beyond-demo/a && touch zx-beyond-demo/a/file.txt && ls zx-beyond-demo/a && rm -rf zx-beyond-demo`;
console.log(`built-ins: ${listing.stdout.trim()}`);
