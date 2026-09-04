#!/usr/bin/env node

/**
 * Batched test runner that runs tests in smaller groups to avoid interference
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const testsDir = join(process.cwd(), 'tests');
const testFiles = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

// Group tests into batches
const batchSize = 5;
const batches = [];
for (let i = 0; i < testFiles.length; i += batchSize) {
  batches.push(testFiles.slice(i, i + batchSize));
}

console.log(
  `🧪 Running ${testFiles.length} test files in ${batches.length} batches...\n`
);

let totalPass = 0;
let totalFail = 0;
const failedFiles = [];

batches.forEach((batch, index) => {
  console.log(`\n📦 Batch ${index + 1}/${batches.length}: ${batch.join(', ')}`);

  const files = batch.map((f) => join(testsDir, f)).join(' ');

  try {
    // Run batch synchronously and capture output
    const output = execSync(`bun test ${files} 2>&1`, { encoding: 'utf-8' });

    // Parse the output to find pass/fail counts
    const passMatch = output.match(/(\d+)\s+pass/);
    const failMatch = output.match(/(\d+)\s+fail/);

    const pass = passMatch ? parseInt(passMatch[1]) : 0;
    const fail = failMatch ? parseInt(failMatch[1]) : 0;

    totalPass += pass;
    totalFail += fail;

    if (fail > 0) {
      console.log(`   ❌ ${pass} pass, ${fail} fail`);
      failedFiles.push(
        ...batch.filter((f) =>
          // Try to identify which files had failures
          output.includes(f)
        )
      );
    } else {
      console.log(`   ✅ ${pass} pass`);
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
      console.log(`   ❌ ${pass} pass, ${fail} fail`);
      failedFiles.push(...batch);
    } else {
      console.log(`   ⚠️  Error running batch`);
      failedFiles.push(...batch);
    }
  }
});

console.log(`\n${'='.repeat(60)}`);
console.log('📊 Summary:');
console.log(`   Total tests passed: ${totalPass}`);
console.log(`   Total tests failed: ${totalFail}`);
console.log(
  `   Batches with issues: ${failedFiles.length > 0 ? failedFiles.length : 0}`
);

if (failedFiles.length > 0) {
  console.log('\n❌ Files with potential issues:');
  [...new Set(failedFiles)].forEach((f) => console.log(`   - ${f}`));
  process.exit(1);
} else {
  console.log('\n✅ All batches completed successfully!');
  process.exit(0);
}
