#!/usr/bin/env bun
/**
 * TypeScript: commands, options and typed results.
 *
 * Run with `bun js/examples/typescript-basics.ts` (or Node.js >= 22.18).
 * Type checked by `npm run check:types`.
 */

import {
  $,
  exec,
  run,
  sh,
  type ProcessOptions,
  type StreamResult,
} from 'command-stream';

const options: ProcessOptions = { mirror: false, capture: true };
const quiet = $(options);

// Awaiting a command yields a fully typed StreamResult.
const greeting: StreamResult = await quiet`echo ${'hello, typed world'}`;
console.log(`echo -> ${greeting.stdout?.trim()} (exit ${greeting.code})`);

// Arrays expand into separately quoted arguments.
const files = ['a file.txt', 'b.txt'];
const listed = await quiet`echo ${files}`;
console.log(`array -> ${listed.stdout?.trim()}`);

// Captured output also works as plain text.
const text: string = await greeting.text();
console.log(`text() -> ${text.trim()}`);

// Direct execution without a shell, with typed argv.
const version = await exec(process.execPath, ['--version'], options);
console.log(`exec exit code -> ${version.exitCode}`);

// `run` accepts a shell string or an argv array.
const [fromString, fromArgv] = await Promise.all([
  run('echo from-string'),
  run(['echo', 'from-argv']),
]);
console.log(`run -> ${fromString.stdout?.trim()} / ${fromArgv.stdout?.trim()}`);

// `sh` runs a shell command string.
const status = await sh('exit 3', options);
console.log(`sh exit code -> ${status.code}`);
