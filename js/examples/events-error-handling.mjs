#!/usr/bin/env node

// Error handling and recovery with events

import { $ } from '../src/$.mjs';

console.log('Error handling and recovery:');
const $errorTest = $({ mirror: false });

try {
  // First try a command that will fail
  console.log('Testing error handling...');
  const failRunner = $errorTest`ping -c 2 invalid.host.name.that.does.not.exist`;

  const errorMessages = [];

  failRunner.on('stdout', (data) => {
    console.log(`📤 Stdout: ${data.toString().trim()}`);
  });

  failRunner.on('stderr', (data) => {
    const error = data.toString().trim();
    errorMessages.push(error);
    console.log(`🚨 Stderr: ${error}`);
  });

  failRunner.on('close', (code) => {
    console.log(`🔚 Failed command exit code: ${code}`);
    console.log(`📝 Error messages collected: ${errorMessages.length}`);
  });

  try {
    await failRunner;
  } catch (error) {
    console.log(`⚠️  Caught error: ${error.message}`);
  }

  // Then try a command that succeeds
  console.log('\nTesting successful recovery...');
  const successRunner = $errorTest`ping -c 2 127.0.0.1`;

  let successCount = 0;

  successRunner.on('stdout', (data) => {
    const output = data.toString().trim();
    if (output.includes('bytes from')) {
      successCount++;
      console.log(`✅ Success #${successCount}: Local ping OK`);
    }
  });

  successRunner.on('close', (code) => {
    console.log(`🎯 Recovery successful with code: ${code}`);
  });

  await successRunner;
} catch (error) {
  console.log(`❌ Unexpected error: ${error.message}`);
}
