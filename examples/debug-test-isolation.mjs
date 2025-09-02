#!/usr/bin/env node

import { spawn } from 'child_process';
import { readdirSync } from 'fs';

// Get all test files
const testFiles = readdirSync('tests').filter(f => f.endsWith('.test.mjs'));

function getSigintHandlerCount() {
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter(l => {
    const str = l.toString();
    return str.includes('activeProcessRunners') || 
           str.includes('ProcessRunner') ||
           str.includes('activeChildren');
  });
  return commandStreamListeners.length;
}

console.log('=== Test Isolation Debug ===');
console.log(`Initial SIGINT handlers: ${getSigintHandlerCount()}`);

// Run a few key tests individually and check handler count
const keyTests = [
  'resource-cleanup-internals.test.mjs',
  'cleanup-verification.test.mjs', 
  'sigint-cleanup.test.mjs',
  'sigint-cleanup-isolated.test.mjs'
];

for (const testFile of keyTests) {
  console.log(`\n--- Running ${testFile} ---`);
  console.log(`Before: ${getSigintHandlerCount()} handlers`);
  
  try {
    const result = spawn('bun', ['test', `tests/${testFile}`, '--verbose'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      timeout: 30000
    });
    
    await new Promise((resolve, reject) => {
      result.on('close', resolve);
      result.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 30000);
    });
    
    console.log(`After: ${getSigintHandlerCount()} handlers`);
  } catch (error) {
    console.log(`Error running ${testFile}:`, error.message);
    console.log(`After (with error): ${getSigintHandlerCount()} handlers`);
  }
}