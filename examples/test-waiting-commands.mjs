#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Commands that definitely wait for stdin ===');

async function testWaitingCommands() {
  try {
    
    console.log('\\n1️⃣ cat with no arguments - waits for stdin');
    const cmd1 = $`timeout 2 cat`; // Timeout as safety
    const stdin1 = await cmd1.streams.stdin;
    console.log('cat stdin type:', typeof stdin1);
    
    if (stdin1 && stdin1.write) {
      stdin1.write('Hello cat!\\n');
      stdin1.end();
    }
    
    const result1 = await cmd1;
    console.log('cat result:', JSON.stringify(result1.stdout));
    
    console.log('\\n2️⃣ sort with no arguments - waits for stdin');
    const cmd2 = $`timeout 2 sort`;
    const stdin2 = await cmd2.streams.stdin;
    console.log('sort stdin type:', typeof stdin2);
    
    if (stdin2 && stdin2.write) {
      stdin2.write('zebra\\n');
      stdin2.write('apple\\n');
      stdin2.end();
    }
    
    const result2 = await cmd2;
    console.log('sort result:', JSON.stringify(result2.stdout));
    
    console.log('\\n3️⃣ wc (word count) - waits for stdin');
    const cmd3 = $`timeout 2 wc -l`;
    const stdin3 = await cmd3.streams.stdin;
    console.log('wc stdin type:', typeof stdin3);
    
    if (stdin3 && stdin3.write) {
      stdin3.write('line 1\\n');
      stdin3.write('line 2\\n');
      stdin3.end();
    }
    
    const result3 = await cmd3;
    console.log('wc result:', JSON.stringify(result3.stdout));
    
    console.log('\\n4️⃣ head -n 1 - waits for stdin, takes first line');
    const cmd4 = $`timeout 2 head -n 1`;
    const stdin4 = await cmd4.streams.stdin;
    console.log('head stdin type:', typeof stdin4);
    
    if (stdin4 && stdin4.write) {
      stdin4.write('first line\\n');
      stdin4.write('second line\\n');
      stdin4.end();
    }
    
    const result4 = await cmd4;
    console.log('head result:', JSON.stringify(result4.stdout));
    
    console.log('\\n5️⃣ Node.js process.stdin - definitely waits');
    const cmd5 = $\`node -e "
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', d => process.stdout.write('Got: ' + d));
      process.stdin.on('end', () => process.exit(0));
    "\`;
    const stdin5 = await cmd5.streams.stdin;
    console.log('node stdin type:', typeof stdin5);
    
    if (stdin5 && stdin5.write) {
      stdin5.write('Node test\\n');
      stdin5.end();
    }
    
    const result5 = await cmd5;
    console.log('node result:', JSON.stringify(result5.stdout));
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

testWaitingCommands();