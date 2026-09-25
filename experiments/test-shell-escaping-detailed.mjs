#!/usr/bin/env node
/**
 * Detailed investigation of shell escaping behavior
 */

import { $, raw } from '../js/src/$.mjs';

console.log('=== Detailed Shell Escaping Investigation ===\n');

const testText = "didn't";

// Test 1: Direct shell command (baseline)
console.log('1. Direct shell command without interpolation:');
const result1 = await $`echo "didn't"`.run({ capture: true, mirror: false });
console.log(`   Result: "${result1.stdout.trim()}"`);
console.log(`   Expected: "didn't"`);
console.log(`   Correct: ${result1.stdout.trim() === "didn't" ? '✅' : '❌'}`);

// Test 2: With interpolation and user-provided double quotes
console.log(
  '\n2. Interpolation with user-provided double quotes: $`echo "${text}"`'
);
const result2 = await $`echo "${testText}"`.run({
  capture: true,
  mirror: false,
});
console.log(`   Result: "${result2.stdout.trim()}"`);

// Test 3: With interpolation (no quotes around variable)
console.log('\n3. Interpolation without quotes: $`echo ${text}`');
const result3 = await $`echo ${testText}`.run({ capture: true, mirror: false });
console.log(`   Result: "${result3.stdout.trim()}"`);

// Test 4: Using printf to see the exact bytes
console.log('\n4. Using sh -c to verify shell interpretation:');
const result4 = await $`sh -c 'echo "didn'"'"'t"'`.run({
  capture: true,
  mirror: false,
});
console.log(`   Result: "${result4.stdout.trim()}"`);

// Test 5: Let's manually test the quote function logic
console.log('\n5. Understanding the escaping chain:');
console.log(`   Input text: "${testText}"`);
console.log(
  `   The quote() function produces: '${testText.replace(/'/g, "'\\''")}'`
);
console.log(
  `   This should expand to: ${testText} when interpreted by the shell`
);

// Test 6: Test echo with properly escaped single quote
console.log('\n6. Test if the shell correctly expands the escape:');
const shellCmd = `echo '${testText.replace(/'/g, "'\\''")}'`;
console.log(`   Command: ${shellCmd}`);
const result6 = await $`sh -c ${shellCmd}`.run({
  capture: true,
  mirror: false,
});
console.log(`   Result: "${result6.stdout.trim()}"`);

// Test 7: What command is actually being built?
console.log('\n7. Inspecting the actual command being built:');
const verbose = process.env.COMMAND_STREAM_VERBOSE;
process.env.COMMAND_STREAM_VERBOSE = 'true';
// Just note: we can't easily inspect the built command without modifying the library
// but we know from the code that buildShellCommand is called
console.log(
  `   Note: quote("${testText}") returns: '${testText.replace(/'/g, "'\\''")}' (single-quoted with escaped apostrophe)`
);
process.env.COMMAND_STREAM_VERBOSE = verbose;

// Test 8: Direct execution of expected result
console.log('\n8. Direct execution with raw:');
const result8 = await $`${raw(`echo '${testText}'`)}`.run({
  capture: true,
  mirror: false,
});
console.log(`   Using raw("echo \'${testText}\'"): "${result8.stdout.trim()}"`);

console.log('\n=== Analysis ===\n');
console.log('The key insight is:');
console.log('- When we use $`echo "${testText}"`, command-stream:');
console.log('  1. Sees the " as part of the template string');
console.log('  2. Quotes the interpolated value with single quotes');
console.log("  3. The resulting command is: echo \"'didn'\\''t'\"");
console.log('  4. This has DOUBLE quoting: user"s quotes + library\'s quotes');
console.log('');
console.log('The real issue is that the user\'s " quotes are part of the');
console.log('static template string, and then the library adds MORE quotes!');
