#!/usr/bin/env node

/**
 * Simple test runner that runs all tests individually and reports results
 */

import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

// Run `bun test` without a shell, so a checkout path with spaces or shell
// metacharacters stays one argument. Bun prints its summary on stderr, so the
// returned output is both streams, as `2>&1` used to give; a failing run throws
// with that output on `error.stdout`, like execSync did.
function runBunTest(paths) {
  const result = spawnSync('bun', ['test', ...paths], { encoding: 'utf-8' });
  if (result.error) {
    throw result.error;
  }
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) {
    const error = new Error(`bun test exited with ${result.status}`);
    error.stdout = output;
    throw error;
  }
  return output;
}

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
    const output = runBunTest([filePath]);

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
