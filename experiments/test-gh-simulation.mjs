#!/usr/bin/env node
/**
 * Simulate the gh CLI receiving arguments to understand the issue
 *
 * When you run: gh release create v1.0.0 --notes "text with apostrophe's"
 * The shell expands it, and gh receives the expanded text
 *
 * But when you run via command-stream:
 * $`gh release create v1.0.0 --notes "${text}"`
 *
 * What does gh actually receive?
 */

import { $, raw } from '../js/src/$.mjs';
import { spawn } from 'child_process';
import { promisify } from 'util';

console.log('=== Simulating What gh CLI Would Receive ===\n');

const testText = "Dependencies didn't exist";

// Method 1: Create a script that echoes its arguments
console.log('1. Creating argument inspection script...');

// Write a simple script that shows exactly what arguments it receives
const scriptContent = `#!/bin/bash
echo "Number of args: $#"
for arg in "$@"; do
    echo "Arg: [$arg]"
done
`;

await $`echo ${raw(`'${scriptContent}'`)} > /tmp/show-args.sh && chmod +x /tmp/show-args.sh`.run(
  { capture: true, mirror: false }
);

console.log('\n2. Testing direct shell (how user expects it to work):');
const result1 =
  await $`/tmp/show-args.sh "This is ${raw("apostrophe's")} text"`.run({
    capture: true,
    mirror: false,
  });
console.log(result1.stdout);

console.log('3. Testing with interpolation (what actually happens):');
const result2 = await $`/tmp/show-args.sh "This is ${testText}"`.run({
  capture: true,
  mirror: false,
});
console.log(result2.stdout);

console.log('4. Testing proper usage WITHOUT user quotes:');
const result3 = await $`/tmp/show-args.sh ${testText}`.run({
  capture: true,
  mirror: false,
});
console.log(result3.stdout);

console.log('5. Testing with raw():');
const result4 = await $`/tmp/show-args.sh ${raw(`"${testText}"`)}`.run({
  capture: true,
  mirror: false,
});
console.log(result4.stdout);

console.log('\n=== Key Finding ===');
console.log("The issue is NOT in command-stream's escaping mechanism itself.");
console.log(
  'The quote() function correctly escapes single quotes for the shell.'
);
console.log('\nThe issue is that when users write:');
console.log('  $`gh release create --notes "${text}"`');
console.log('');
console.log('They are DOUBLE-quoting:');
console.log('  1. Their " " quotes are in the template string');
console.log(
  "  2. command-stream adds ' ' quotes around the interpolated value"
);
console.log('');
console.log('So the command becomes:');
console.log("  gh release create --notes \"'escaped'\\''text'\"");
console.log('');
console.log('The correct usage is:');
console.log('  $`gh release create --notes ${text}`');
console.log('(Let command-stream handle the quoting!)');

console.log('\n=== When Does Triple Quote Appear? ===');
console.log(
  "If the shell command is passed to a program that doesn't interpret"
);
console.log('the escaping, but stores/forwards the text literally, then the');
console.log("escape sequence '\\'' appears as '''.");

// Cleanup
await $`rm /tmp/show-args.sh`.run({ capture: true, mirror: false });
