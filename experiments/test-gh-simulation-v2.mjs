#!/usr/bin/env node
/**
 * Simulate the gh CLI receiving arguments to understand the issue
 */

import { $, raw } from '../js/src/$.mjs';
import fs from 'fs/promises';

console.log('=== Simulating What gh CLI Would Receive ===\n');

const testText = "Dependencies didn't exist";

// Create a script that echoes its arguments
const scriptPath = '/tmp/show-args.sh';
await fs.writeFile(scriptPath, `#!/bin/bash
echo "Number of args: $#"
for arg in "$@"; do
    echo "Arg: [$arg]"
done
`);
await fs.chmod(scriptPath, '755');

console.log('1. Direct shell command (baseline - no interpolation):');
const result1 = await $`/tmp/show-args.sh "Text with apostrophe's"`.run({ capture: true, mirror: false });
console.log(result1.stdout);

console.log('2. Using interpolation WITH user-provided quotes (the bug):');
const result2 = await $`/tmp/show-args.sh "${testText}"`.run({ capture: true, mirror: false });
console.log(result2.stdout);

console.log('3. Using interpolation WITHOUT user quotes (correct usage):');
const result3 = await $`/tmp/show-args.sh ${testText}`.run({ capture: true, mirror: false });
console.log(result3.stdout);

console.log('4. Using raw() function:');
const result4 = await $`/tmp/show-args.sh ${raw(`"${testText}"`)}`.run({ capture: true, mirror: false });
console.log(result4.stdout);

// Cleanup
await fs.unlink(scriptPath);

console.log('=== Analysis ===');
console.log('Test 1 shows expected output - shell correctly handles quotes');
console.log('Test 2 shows double-quoting issue when user adds quotes + library adds quotes');
console.log('Test 3 shows correct usage - let the library handle quoting');
console.log('Test 4 shows raw() preserves the user\'s exact text');
