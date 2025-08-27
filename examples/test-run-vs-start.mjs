#!/usr/bin/env node

import { $ } from '../$.mjs';

async function compareRunVsStart() {
  console.log('=== Comparing .run() vs .start() methods ===');
  console.log('Both methods are identical - .run() is just an alias for .start()');
  
  console.log('\n1. Using .start() method:');
  const startResult = await $`echo "Using .start() method"`.start({ mirror: false });
  console.log(`  Result: ${JSON.stringify(startResult.stdout)}`);
  console.log(`  Code: ${startResult.code}`);
  
  console.log('\n2. Using .run() method (identical functionality):');
  const runResult = await $`echo "Using .run() method"`.run({ mirror: false });
  console.log(`  Result: ${JSON.stringify(runResult.stdout)}`);
  console.log(`  Code: ${runResult.code}`);
  
  console.log('\n3. Both support all the same options:');
  
  // Test with multiple options using .start()
  console.log('\n   .start() with multiple options:');
  const startMultiple = await $`cat`.start({
    stdin: "Input for start method",
    capture: true,
    mirror: false
  });
  console.log(`   Output: ${JSON.stringify(startMultiple.stdout)}`);
  
  // Test with multiple options using .run()
  console.log('\n   .run() with multiple options:');
  const runMultiple = await $`cat`.run({
    stdin: "Input for run method",
    capture: true,
    mirror: false
  });
  console.log(`   Output: ${JSON.stringify(runMultiple.stdout)}`);
  
  console.log('\n4. Performance comparison:');
  const iterations = 10;
  
  // Time .start()
  const startTime1 = Date.now();
  for (let i = 0; i < iterations; i++) {
    await $`echo "start ${i}"`.start({ capture: false, mirror: false });
  }
  const startDuration = Date.now() - startTime1;
  
  // Time .run()
  const startTime2 = Date.now();
  for (let i = 0; i < iterations; i++) {
    await $`echo "run ${i}"`.run({ capture: false, mirror: false });
  }
  const runDuration = Date.now() - startTime2;
  
  console.log(`   .start() ${iterations} iterations: ${startDuration}ms`);
  console.log(`   .run()   ${iterations} iterations: ${runDuration}ms`);
  console.log(`   Difference: ${Math.abs(startDuration - runDuration)}ms (should be minimal)`);
  
  console.log('\n✅ Conclusion:');
  console.log('  - .run() and .start() are functionally identical');
  console.log('  - .run() is just an alias for .start()');
  console.log('  - Use whichever name you prefer');
  console.log('  - Both solve the GitHub issue #16 requirement');
  
  console.log('\n🔗 GitHub Issues addressed:');
  console.log('  - Issue #16: .start() should have .run() alias ✅');
  console.log('  - Issue #17: Pass options through $`...`.start/run(...) ✅');
}

compareRunVsStart().catch(console.error);