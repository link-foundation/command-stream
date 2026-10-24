#!/usr/bin/env node
// Running a generated script through `bash -c "..."` (issue #49).
// Values interpolated inside quotes you wrote yourself are spliced in as
// escaped literal text, exactly like "$var" in a POSIX shell.
import { $ } from '../src/$.mjs';

const $q = $({ mirror: false });

const script = 'for word in one two three; do echo "Processing: $word"; done';

// The script reaches bash as a single argument, with its own quotes intact.
const loop = await $q`bash -c "${script}"`;
console.log(loop.stdout.trim());

// A value cannot end the quote and append a command: `echo pwned` never runs,
// it is passed to the inner shell as part of the same `echo` command.
const untrusted = '"; echo pwned; echo "';
const safe = await $q`bash -c "echo ${untrusted}"`;
console.log(`no injection: ${JSON.stringify(safe.stdout)}`);

// Outside quotes nothing changes: the value is quoted for you.
const path = '/tmp/my file.txt';
console.log((await $q`echo ${path}`).stdout.trim());
