#!/usr/bin/env node

/**
 * Simple test runner that runs all tests individually and reports results
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const testsDir = join(process.cwd(), 'tests');
const testFiles = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

console.log(`🧪 Running ${testFiles.length} test files individually...\n`);

let totalPass = 0;
let totalFail = 0;
const failedFiles = [];

for (const file of testFiles) {
  const filePath = join(testsDir, file);

  try {
    // Run test synchronously and capture output
    const output = execSync(`bun test ${filePath} 2>&1`, { encoding: 'utf-8' });

    // Parse the output to find pass/fail counts
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
    // Test failed to run or had non-zero exit
    const output = error.stdout || '';
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
      console.log(`⚠️  ${file}: Error running test`);
      failedFiles.push(file);
    }
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
