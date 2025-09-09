#!/usr/bin/env node
import { $ } from '../src/$.mjs';
import fs from 'fs';

// Proper usage test - demonstrates the correct way to use JSON with shell commands
console.log('🔍 Proper JSON usage test...');

const jsonData = {
  name: "Test Project",
  description: "A project with \"quotes\" and 'apostrophes'",
  scripts: {
    test: "echo \"Running tests\"",
    build: "node build.js --env='production'"
  },
  config: {
    special: "Value with `backticks` and $variables"
  }
};

const jsonString = JSON.stringify(jsonData, null, 2);
const outputFile = '/tmp/proper-json-test.json';

console.log('📝 Original JSON:');
console.log(jsonString);
console.log();

// CORRECT USAGE: Write to file using redirection
console.log('✅ Writing JSON to file using shell redirection...');
const cmd1 = $({ mirror: false })`echo ${jsonString} > ${outputFile}`;
console.log('Command:', cmd1.spec.command.substring(0, 80) + '...');

await cmd1;

// Read back and validate
console.log('📖 Reading back from file...');
const fileContent = await fs.promises.readFile(outputFile, 'utf-8');
console.log('File content:');
console.log(fileContent);
console.log();

console.log('🔍 Validating JSON from file...');
try {
  const parsed = JSON.parse(fileContent);
  console.log('✅ SUCCESS: File contains valid JSON!');
  console.log('✅ Name:', parsed.name);
  console.log('✅ Description contains quotes:', parsed.description.includes('"quotes"') && parsed.description.includes("'apostrophes'"));
  console.log('✅ Special chars preserved:', parsed.config.special.includes('`backticks`') && parsed.config.special.includes('$variables'));
} catch (e) {
  console.log('❌ FAILED: File JSON is invalid:', e.message);
}

console.log();

// ALTERNATIVE USAGE: Just echo to stdout (what the user might expect)
console.log('✅ Echoing JSON to stdout for processing...');
const result = await $({ capture: true, mirror: false })`echo ${jsonString}`;
const stdoutJson = result.stdout.trim();

console.log('🔍 Validating JSON from stdout...');
try {
  const parsed = JSON.parse(stdoutJson);
  console.log('✅ SUCCESS: Stdout contains valid JSON!');
  console.log('✅ Can be piped to other commands or processed');
} catch (e) {
  console.log('❌ FAILED: Stdout JSON is invalid:', e.message);
  console.log('Raw stdout:', JSON.stringify(stdoutJson));
}

console.log();

// Show the difference between old and new behavior
console.log('🔍 Comparison - the old behavior would have looked like:');
console.log("OLD: echo '{  \"name\": \"Test Project\",  \"description\": \"A project with \\\"quotes\\\" and '\\''apostrophes'\\''\",...}'");
console.log('NEW:', cmd1.spec.command.substring(0, 120) + '...');
console.log('✅ The new behavior properly preserves JSON structure!');