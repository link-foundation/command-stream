#!/usr/bin/env node
// Virtual `tee`: copy a command's output to files while it keeps flowing
// through the pipeline (issue #14).
import { $ } from '../src/$.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'tee-example-'));
const log = join(dir, 'build.log');
const audit = join(dir, 'audit.log');

// 1. Capture output to a file and keep it on stdout.
const build = await $`echo "build finished"`.pipe($`tee ${log}`);
console.log('stdout :', JSON.stringify(build.stdout));
console.log('file   :', JSON.stringify(readFileSync(log, 'utf8')));

// 2. Append a second run instead of truncating, and fan out to two files.
await $`echo "second run"`.pipe($`tee -a ${log} ${audit}`);
console.log('appended:', JSON.stringify(readFileSync(log, 'utf8')));
console.log('audit   :', JSON.stringify(readFileSync(audit, 'utf8')));

// 3. tee sits in the middle of a pipeline: downstream still receives the data.
const piped = await $`echo "hello tee" | tee ${log} | tr a-z A-Z`;
console.log('piped   :', JSON.stringify(piped.stdout));

// 4. A target that cannot be written reports an error, but the remaining
//    targets and stdout are still written and the exit code becomes 1.
const partial = await $({
  stdin: 'still delivered\n',
})`tee /invalid/path/nope.log ${audit}`;
console.log('code    :', partial.code);
console.log('stderr  :', JSON.stringify(partial.stderr));
console.log('stdout  :', JSON.stringify(partial.stdout));

// Virtual commands receive stdin as a completed buffer, so this `tee` is a
// pipeline stage rather than a live terminal filter. Use `interactive: true`
// with the system binary when you need keystroke-by-keystroke behaviour.
rmSync(dir, { recursive: true, force: true });
