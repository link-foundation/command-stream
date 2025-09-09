#!/usr/bin/env node

// Test to check how shell parser handles 2>&1
import { parseShellCommand, needsRealShell } from '../src/shell-parser.mjs';

function testShellParser() {
  console.log('🔧 Testing shell parser with different commands...\n');
  
  const testCommands = [
    'git push origin main',
    'git push origin main 2>&1',
    'git push origin main 2>error.log',
    'git push origin main &>output.log',
    'git push origin main >&2',
    'ls -la',
    'echo hello | grep hello'
  ];
  
  for (const cmd of testCommands) {
    console.log(`Command: ${cmd}`);
    console.log(`  needsRealShell: ${needsRealShell(cmd)}`);
    
    try {
      const parsed = parseShellCommand(cmd);
      console.log(`  parsed:`, JSON.stringify(parsed, null, 2));
    } catch (error) {
      console.log(`  parsing error:`, error.message);
    }
    console.log('');
  }
}

testShellParser();