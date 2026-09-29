#!/usr/bin/env node

/**
 * Test runner that runs all tests individually and reports results
 * This helps identify test issues and ensures all tests pass in isolation
 */

import { $ } from '../src/$.mjs';
import { readdirSync } from 'fs';
import { join, basename } from 'path';

const testsDir = join(process.cwd(), 'tests');
const testFiles = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

console.log(`\n🧪 Running ${testFiles.length} test files individually...\n`);

let totalPass = 0;
let totalFail = 0;
const failedFiles = [];

for (const file of testFiles) {
  const filePath = join(testsDir, file);

  try {
    // Run the test and capture output
    const result = await $`bun test ${filePath}`;

    // Parse the output to find pass/fail counts
    const output = result.stdout;
    const passMatch = output.match(/(\d+)\s+pass/);
    const failMatch = output.match(/(\d+)\s+fail/);

    const pass = passMatch ? parseInt(passMatch[1]) : 0;
    const fail = failMatch ? parseInt(failMatch[1]) : 0;

    totalPass += pass;
    totalFail += fail;

    if (fail > 0) {
      console.log(`❌ ${file}: ${pass} pass, ${fail} fail`);
      failedFiles.push(file);
    } else {
      console.log(`✅ ${file}: ${pass} pass`);
    }
  } catch (error) {
    console.log(`⚠️  ${file}: Error running test`);
    console.error(`   ${error.message}`);
    failedFiles.push(file);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log('📊 Summary:');
console.log(`   Total tests passed: ${totalPass}`);
console.log(`   Total tests failed: ${totalFail}`);
console.log(`   Files with failures: ${failedFiles.length}`);

if (failedFiles.length > 0) {
  console.log('\n❌ Failed test files:');
  failedFiles.forEach((f) => console.log(`   - ${f}`));
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
