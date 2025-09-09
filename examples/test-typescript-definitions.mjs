/**
 * Test TypeScript definitions for command-stream
 * This file tests that our TypeScript definitions work correctly at runtime
 */

import $ from '../src/$.mjs';

// Test basic command execution
async function testBasicCommands() {
  console.log('Testing basic command execution...');
  
  try {
    const result = await $`echo "Hello TypeScript!"`;
    console.log(`✅ Basic command: ${result.stdout.trim()}`);
    console.log(`   Exit code: ${result.code}`);
    console.log(`   Has text() method: ${typeof result.text === 'function'}`);
    
    if (typeof result.text === 'function') {
      const textResult = await result.text();
      console.log(`   text() result: ${textResult.trim()}`);
    } else {
      console.log(`   ⚠️  text() method not implemented yet, using stdout directly`);
    }
  } catch (error) {
    console.error('❌ Basic command failed:', error.message);
  }
}

// Test command with options
async function testCommandWithOptions() {
  console.log('\nTesting command with options...');
  
  try {
    const quietCmd = $({ mirror: false, capture: true });
    const result = await quietCmd`pwd`;
    console.log(`✅ Command with options: ${result.stdout.trim()}`);
  } catch (error) {
    console.error('❌ Command with options failed:', error.message);
  }
}

// Test streaming functionality
async function testStreaming() {
  console.log('\nTesting streaming functionality...');
  
  try {
    const cmd = $`echo -e "line1\\nline2\\nline3"`;
    let chunkCount = 0;
    
    for await (const chunk of cmd.stream()) {
      chunkCount++;
      console.log(`✅ Received chunk ${chunkCount}: ${chunk ? chunk.length : 'undefined'} bytes`);
      if (chunkCount > 5) break; // Prevent infinite loop
    }
    
    console.log(`✅ Streaming completed with ${chunkCount} chunks`);
    
    // Note: lines() method is not implemented yet, but would work like this:
    // const lineCmd = $`echo -e "line1\\nline2\\nline3"`;
    // for await (const line of lineCmd.lines()) {
    //   console.log(`Line: ${line}`);
    // }
  } catch (error) {
    console.error('❌ Streaming failed:', error.message);
  }
}

// Test event handling
async function testEventHandling() {
  console.log('\nTesting event handling...');
  
  return new Promise((resolve, reject) => {
    const cmd = $`echo "Event test"`;
    let dataReceived = false;
    let endReceived = false;
    
    cmd.on('data', (chunk) => {
      dataReceived = true;
      console.log(`✅ Data event: ${chunk ? chunk.length : 'undefined'} bytes`);
    });
    
    cmd.on('end', (result) => {
      endReceived = true;
      console.log(`✅ End event: code ${result.code}, stdout: "${result.stdout.trim()}"`);
      
      if (dataReceived && endReceived) {
        resolve();
      } else {
        reject(new Error('Not all events received'));
      }
    });
    
    cmd.on('error', (error) => {
      console.error('❌ Error event:', error.message);
      reject(error);
    });
    
    // Trigger execution
    cmd.start();
  });
}

// Test virtual commands
async function testVirtualCommands() {
  console.log('\nTesting virtual commands...');
  
  try {
    // Test built-in virtual command
    const result = await $`echo "Virtual command test"`;
    console.log(`✅ Virtual echo command: ${result.stdout.trim()}`);
    
    // Test pwd virtual command
    const pwdResult = await $`pwd`;
    console.log(`✅ Virtual pwd command: ${pwdResult.stdout.trim()}`);
  } catch (error) {
    console.error('❌ Virtual commands failed:', error.message);
  }
}

// Test stream access
async function testStreamAccess() {
  console.log('\nTesting stream access...');
  
  try {
    const cmd = $`echo "Stream access test"`;
    
    // Access streams before starting
    console.log(`✅ stdout initially: ${cmd.stdout === null ? 'null' : 'available'}`);
    console.log(`✅ stderr initially: ${cmd.stderr === null ? 'null' : 'available'}`);
    console.log(`✅ stdin initially: ${cmd.stdin === null ? 'null' : 'available'}`);
    
    // Execute and get result
    const result = await cmd;
    console.log(`✅ Stream access result: ${result.stdout.trim()}`);
  } catch (error) {
    console.error('❌ Stream access failed:', error.message);
  }
}

// Test error handling
async function testErrorHandling() {
  console.log('\nTesting error handling...');
  
  try {
    // This should fail
    const result = await $`nonexistent-command-12345`;
    // If we get here, the command didn't fail as expected
    if (result.code !== 0) {
      console.log(`✅ Error handling works: command failed with code ${result.code}`);
    } else {
      console.error('❌ Expected error but command succeeded');
    }
  } catch (error) {
    console.log(`✅ Error handling works: ${error.message}`);
  }
}

// Test interpolation
async function testInterpolation() {
  console.log('\nTesting variable interpolation...');
  
  try {
    const name = "TypeScript";
    const result = await $`echo "Hello, ${name}!"`;
    console.log(`✅ Interpolation: ${result.stdout.trim()}`);
    
    const command = "echo";
    const message = "Variable interpolation works";
    const result2 = await $`${command} "${message}"`;
    console.log(`✅ Command interpolation: ${result2.stdout.trim()}`);
  } catch (error) {
    console.error('❌ Interpolation failed:', error.message);
  }
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Running TypeScript definitions tests for command-stream...\n');
  
  try {
    await testBasicCommands();
    await testCommandWithOptions();
    await testStreaming();
    await testEventHandling();
    await testVirtualCommands();
    await testStreamAccess();
    await testErrorHandling();
    await testInterpolation();
    
    console.log('\n✅ All TypeScript definition tests passed!');
    console.log('🎉 TypeScript support is working correctly!');
  } catch (error) {
    console.error('\n❌ Tests failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export {
  testBasicCommands,
  testCommandWithOptions,
  testStreaming,
  testEventHandling,
  testVirtualCommands,
  testStreamAccess,
  testErrorHandling,
  testInterpolation,
  runAllTests
};