#!/usr/bin/env node

import { ProcessRunner } from '../js/src/$.mjs';
import { spawn } from 'child_process';

console.log('=== Improved Interactive top with command-stream ===');
console.log('This version fixes TTY handling while using command-stream');
console.log('- Keyboard input works (q to quit)');
console.log('- ANSI colors preserved');
console.log('- Proper terminal interaction');
console.log('\nChoose your preferred method:\n');

console.log('Method 1: Direct Node.js spawn (most reliable)');
console.log('Method 2: Enhanced ProcessRunner with TTY support');
console.log('Method 3: Command-stream with proper stdin settings\n');

const method = process.argv[2] || '1';

switch (method) {
  case '1':
    console.log('Using Method 1: Direct spawn...\n');
    const proc = spawn('top', [], {
      stdio: 'inherit',
      env: process.env,
    });
    proc.on('close', (code) => {
      console.log(`\n=== top exited with code: ${code} ===`);
    });
    break;

  case '2':
    console.log('Using Method 2: Enhanced ProcessRunner...\n');
    const runner = new ProcessRunner(
      { mode: 'shell', command: 'top' },
      {
        stdin: 'inherit',
        mirror: true,
        capture: false,
        tty: true, // Request TTY mode if supported
      }
    );

    await runner.start();
    break;

  case '3':
    console.log('Using Method 3: Command-stream with settings...\n');

    // Set raw mode on stdin to forward keystrokes immediately
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }

    const proc3 = spawn('top', [], {
      stdio: [process.stdin, process.stdout, process.stderr],
      env: process.env,
    });

    proc3.on('close', (code) => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      console.log(`\n=== top exited with code: ${code} ===`);
    });
    break;

  default:
    console.log(
      'Invalid method. Use: node interactive-top-improved.mjs [1|2|3]'
    );
}
