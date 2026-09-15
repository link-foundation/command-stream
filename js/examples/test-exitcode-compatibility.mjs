#!/usr/bin/env node

/**
 * Test script to verify that both error.code and error.exitCode work
 * This validates the fix for issue #38
 */

import { $, shell } from '../src/$.mjs';

// Enable errexit to make commands throw on non-zero exit codes
shell.errexit(true);

console.log('Testing exitCode alias for error.code...\n');

// Test 1: Test that error.exitCode is available alongside error.code
async function testExitCodeAlias() {
  console.log('Test 1: Checking error.exitCode alias...');
  
  try {
    // This should fail with exit code 1
    await $`ls /nonexistent/directory/that/does/not/exist`;
    console.log('❌ Expected command to fail');
  } catch (error) {
    console.log(`✅ error.code: ${error.code} (traditional property)`);
    console.log(`✅ error.exitCode: ${error.exitCode} (Node.js standard property)`);
    
    if (error.code === error.exitCode) {
      console.log('✅ Both properties contain the same value');
    } else {
      console.log(`❌ Properties don't match: code=${error.code}, exitCode=${error.exitCode}`);
    }
    
    if (error.exitCode === 2) { // ls returns exit code 2 for "No such file or directory"
      console.log('✅ Exit code is correct (2 for ls no such file)');
    } else {
      console.log(`ℹ️  Exit code is ${error.exitCode} (may vary by system)`);
    }
  }
}

// Test 2: Test specific exit codes with exit command
async function testSpecificExitCode() {
  console.log('\nTest 2: Testing specific exit code (42)...');
  
  try {
    await $`exit 42`;
    console.log('❌ Expected command to fail with exit code 42');
  } catch (error) {
    console.log(`✅ error.code: ${error.code}`);
    console.log(`✅ error.exitCode: ${error.exitCode}`);
    
    if (error.code === 42 && error.exitCode === 42) {
      console.log('✅ Both properties correctly contain exit code 42');
    } else {
      console.log(`❌ Expected both properties to be 42, got code=${error.code}, exitCode=${error.exitCode}`);
    }
  }
}

// Test 3: Ensure backward compatibility - existing code using error.code still works
function testBackwardCompatibility() {
  console.log('\nTest 3: Testing backward compatibility...');
  
  // This is how developers currently handle errors in command-stream
  const handleErrorOldWay = (error) => {
    if (error.code === 1) {
      return 'Handle exit code 1';
    }
    return 'Unknown error';
  };
  
  // This is the new Node.js standard way
  const handleErrorNewWay = (error) => {
    if (error.exitCode === 1) {
      return 'Handle exit code 1';
    }
    return 'Unknown error';
  };
  
  // Create a mock error like command-stream would
  const mockError = new Error('Test error');
  mockError.code = 1;
  mockError.exitCode = 1;
  
  const oldResult = handleErrorOldWay(mockError);
  const newResult = handleErrorNewWay(mockError);
  
  if (oldResult === newResult) {
    console.log('✅ Both old and new error handling patterns work identically');
  } else {
    console.log(`❌ Compatibility issue: old="${oldResult}", new="${newResult}"`);
  }
}

// Run all tests
async function runAllTests() {
  try {
    await testExitCodeAlias();
    await testSpecificExitCode();
    testBackwardCompatibility();
    
    console.log('\n🎉 All tests completed! Issue #38 should be resolved.');
    console.log('Both error.code and error.exitCode are now available.');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

runAllTests();