#!/usr/bin/env node

import { $ } from '../$.mjs';

async function debugExecutionPath() {
  console.log('=== Debugging execution path for new options ===');
  
  console.log('\n1. Testing virtual vs real commands:');
  
  // Test with virtual echo command
  console.log('\n   Virtual command (echo):');
  const runner1 = $`echo "virtual test"`;
  console.log('   Runner spec:', runner1.spec);
  console.log('   Runner spec mode:', runner1.spec.mode);
  
  const result1 = await runner1.start({ capture: false });
  console.log('   Final result:', result1);
  
  // Test with real shell command
  console.log('\n   Real shell command (ls):');
  const runner2 = $`ls /tmp`;
  console.log('   Runner spec:', runner2.spec);
  console.log('   Runner spec mode:', runner2.spec.mode);
  
  const result2 = await runner2.start({ capture: false });
  console.log('   Final result keys:', Object.keys(result2));
  console.log('   Result stdout type:', typeof result2.stdout);
  
  console.log('\n2. Testing option merging:');
  const runner3 = $`echo "option merge test"`;
  
  console.log('   Initial options:', runner3.options);
  const result3 = await runner3.start({ 
    capture: false, 
    mirror: false, 
    customOption: 'test' 
  });
  console.log('   Final options:', runner3.options);
  console.log('   Result:', { stdout: result3.stdout, code: result3.code });
  
  console.log('\n3. Testing already started behavior:');
  const runner4 = $`echo "already started"`;
  
  // First start
  const firstResult = await runner4.start({ capture: true });
  console.log('   First start result:', JSON.stringify(firstResult.stdout));
  
  // Try to start again with different options
  const secondResult = await runner4.start({ capture: false });
  console.log('   Second start result (should ignore new options):', JSON.stringify(secondResult.stdout));
  console.log('   Same result reference?', firstResult === secondResult);
}

debugExecutionPath().catch(console.error);