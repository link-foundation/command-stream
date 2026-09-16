#!/usr/bin/env node

// Demonstrates how Go/Docker template flags (`--format {{ ... }}`) behave with
// command-stream's shell-faithful word splitting, and the safe patterns for
// passing a template token that contains an internal space. See issue #172.
//
// Run: node examples/go-template-arguments.mjs
//
// command-stream mirrors a POSIX shell: an UNQUOTED space inside `{{ }}` splits
// the token into multiple arguments (just like bash), so quote it — exactly as
// you would in a shell script.

import { $ } from '../src/$.mjs';

// Print each received argument on its own line so we can see the word splitting.
const PRINTER = new URL('../tests/fixtures/argprint.mjs', import.meta.url)
  .pathname;

async function show(title, run) {
  const result = await run();
  const args = result.stdout
    .split('\n')
    .filter((l) => l.startsWith('ARG['))
    .map((l) => l.slice(4, -1));
  console.log(`${title}\n  -> ${JSON.stringify(args)}\n`);
}

console.log('=== Go template arguments with command-stream ===\n');

// ❌ Unquoted token with a space — split into 3 args (and a one-line warning
//    is printed to stderr explaining why). This is what bash does too.
await show(
  '1. UNQUOTED  --format {{json .Config.Env}}   (BREAKS, splits like bash)',
  () => $({ mirror: false })`node ${PRINTER} --format {{json .Config.Env}}`
);

// ✅ Space-free token stays a single word.
await show(
  '2. NO SPACE  --format {{.Id}}                 (works)',
  () => $({ mirror: false })`node ${PRINTER} --format {{.Id}}`
);

// ✅ Single-quote the template — recommended, mirrors shell scripts.
await show(
  "3. SINGLE-QUOTED  --format '{{json .Config.Env}}'  (works)",
  () => $({ mirror: false })`node ${PRINTER} --format '{{json .Config.Env}}'`
);

// ✅ Interpolate the whole template as one ${value}; it is auto-quoted.
const format = '{{json .Config.Env}}';
await show(
  '4. INTERPOLATED  --format ${format}            (works)',
  () => $({ mirror: false })`node ${PRINTER} --format ${format}`
);

console.log(
  'Tip: set COMMAND_STREAM_NO_TEMPLATE_WARNING=1 to silence the diagnostic.'
);
