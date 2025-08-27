#!/usr/bin/env node

import { $ } from '../$.mjs';

async function demonstrateStartRunOptions() {
  console.log('=== Demonstrating .start() and .run() with options ===');
  
  console.log('\n🔄 Before: Using sh() function for options');
  console.log('// const result = await sh("echo test", { mirror: false });');
  
  console.log('\n✨ Now: Using template literal syntax with options');
  
  // Example 1: Performance optimization
  console.log('\n1. Performance optimization - disable capture:');
  console.log('await $`echo "fast"`.start({ capture: false })');
  const perf = await $`echo "This runs fast without memory capture"`.start({ capture: false });
  console.log(`Exit code: ${perf.code}, Stdout: ${JSON.stringify(perf.stdout)}`);
  
  // Example 2: Silent execution
  console.log('\n2. Silent execution - disable mirroring:');
  console.log('await $`echo "silent"`.start({ mirror: false })');
  const silent = await $`echo "This won't show on console but is captured"`.start({ mirror: false });
  console.log(`Exit code: ${silent.code}, Captured: ${JSON.stringify(silent.stdout)}`);
  
  // Example 3: Using .run() alias
  console.log('\n3. Using .run() alias:');
  console.log('await $`echo "alias"`.run({ capture: true, mirror: false })');
  const alias = await $`echo "Using .run() instead of .start()"`.run({ capture: true, mirror: false });
  console.log(`Exit code: ${alias.code}, Captured: ${JSON.stringify(alias.stdout)}`);
  
  // Example 4: Custom input with options
  console.log('\n4. Custom input with options:');
  console.log('await $`cat`.start({ stdin: "custom", mirror: false })');
  const custom = await $`cat`.start({ 
    stdin: "This is custom input data", 
    mirror: false, 
    capture: true 
  });
  console.log(`Exit code: ${custom.code}, Output: ${JSON.stringify(custom.stdout)}`);
  
  // Example 5: Maximum performance mode
  console.log('\n5. Maximum performance - no capture, no mirror:');
  console.log('await $`echo "blazing"`.start({ capture: false, mirror: false })');
  const blazing = await $`echo "This is blazing fast!"`.start({ capture: false, mirror: false });
  console.log(`Exit code: ${blazing.code}, Stdout: ${JSON.stringify(blazing.stdout)}`);
  
  console.log('\n🎉 All examples completed!');
  console.log('\n💡 Key benefits:');
  console.log('  - No need to use sh() function anymore');
  console.log('  - Template literal syntax with full option control');
  console.log('  - Both .start() and .run() methods work identically');
  console.log('  - Better performance with capture: false');
  console.log('  - Silent execution with mirror: false');
}

demonstrateStartRunOptions().catch(console.error);