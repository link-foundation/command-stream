#!/usr/bin/env node
/**
 * CLI Tool Demo - Examples of using the $ CLI tool
 * 
 * This demonstrates the new $ CLI tool that can be used from the terminal
 * to execute commands with virtual command support.
 * 
 * Usage: node examples/cli-tool-demo.mjs
 */

import { spawn } from 'child_process';
import path from 'path';

const CLI_PATH = path.resolve('./src/cli.mjs');

// Helper to run CLI commands and show output
async function demo(description, command) {
  console.log(`\n🔹 ${description}`);
  console.log(`Command: $ -c '${command}'`);
  console.log('Output:');
  
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, '-c', command], {
      stdio: 'inherit'
    });
    
    child.on('close', (code) => {
      console.log(`Exit code: ${code}\n`);
      resolve(code);
    });
  });
}

async function main() {
  console.log('=== $ CLI Tool Demo ===');
  console.log('Demonstrating the new $ CLI tool with virtual commands support\n');
  
  // Basic virtual commands
  await demo('Basic echo command', 'echo "Hello from $ CLI!"');
  
  await demo('Generate sequence of numbers', 'seq 1 5');
  
  await demo('Show current directory', 'pwd');
  
  await demo('List files in current directory', 'ls');
  
  await demo('Change directory and show new path', 'cd .. && pwd');
  
  // Virtual command utilities
  await demo('Check if a command exists', 'which node');
  
  await demo('Sleep for 2 seconds', 'sleep 2');
  
  await demo('Show environment variable', 'echo $HOME');
  
  // Real system commands also work
  await demo('Run real system command', 'whoami');
  
  await demo('Check system date', 'date');
  
  // Command combinations
  await demo('Multiple commands with &&', 'echo "First" && echo "Second"');
  
  console.log('=== Demo Complete ===');
  console.log('The $ CLI tool successfully executes both virtual and real commands!');
  console.log('\nTo use the CLI tool:');
  console.log('  $ -c \'your command here\'');
  console.log('  $ --help              # Show help');
  console.log('  $ --version           # Show version');
}

main().catch(console.error);