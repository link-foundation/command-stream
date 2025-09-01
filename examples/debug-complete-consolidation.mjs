#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Complete Finish Method Consolidation Test ===');

const tests = [
  {
    name: "Normal completion",
    test: async () => {
      const result = await $`echo "normal"`;
      return { stdout: result.stdout.trim(), code: result.code };
    }
  },
  
  {
    name: "Sync mode",
    test: async () => {
      const result = $`echo "sync"`.sync();
      return { stdout: result.stdout.trim(), code: result.code };
    }
  },
  
  {
    name: "Error handling",
    test: async () => {
      try {
        await $`exit 1`;
        return { error: 'Expected error but got success' };
      } catch (error) {
        return { code: error.code, stdout: error.stdout.trim() };
      }
    }
  },
  
  {
    name: "Pipeline with error",
    test: async () => {
      try {
        await $`echo "test" | exit 1`;
        return { error: 'Expected error but got success' };
      } catch (error) {
        return { code: error.code, stdout: error.stdout.trim() };
      }
    }
  },
  
  {
    name: "Kill scenario",
    test: async () => {
      const runner = $`sleep 0.1`;
      const promise = runner.start();
      
      // Let it start
      await new Promise(resolve => setTimeout(resolve, 10));
      
      runner.kill('SIGTERM');
      
      try {
        await promise;
        return { error: 'Expected error but got success' };
      } catch (error) {
        return { code: error.code, stderr: error.stderr.trim() };
      }
    }
  },
  
  {
    name: "Finally handler",
    test: async () => {
      let finallyExecuted = false;
      
      const result = await $`echo "finally"`.finally(() => {
        finallyExecuted = true;
      });
      
      return { 
        stdout: result.stdout.trim(), 
        code: result.code,
        finallyExecuted 
      };
    }
  }
];

console.log('\nRunning comprehensive tests...\n');

for (const { name, test } of tests) {
  try {
    const result = await test();
    console.log(`✅ ${name}:`, JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(`❌ ${name}:`, error.message);
  }
}

console.log('\n=== All tests completed ===');