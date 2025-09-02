#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Most reliable stdin commands ===');

async function reliableStdinCommands() {
  try {
    
    console.log('\\n1️⃣ cat (classic stdin reader)');
    const catCmd = $`cat`;
    const catStdin = await catCmd.streams.stdin;
    console.log('  stdin type:', typeof catStdin, 'has write?', !!(catStdin && catStdin.write));
    
    if (catStdin && catStdin.write) {
      catStdin.write('Hello cat!\\n');
      catStdin.write('Second line\\n');
      catStdin.end();
      console.log('  ✅ Wrote data to cat');
    } else {
      console.log('  ❌ No writable stdin');
    }
    
    const catResult = await catCmd;
    console.log('  📤 Result:', JSON.stringify(catResult.stdout));
    
    console.log('\\n2️⃣ sort (sorts stdin lines)');
    const sortCmd = $`sort`;
    const sortStdin = await sortCmd.streams.stdin;
    console.log('  stdin type:', typeof sortStdin, 'has write?', !!(sortStdin && sortStdin.write));
    
    if (sortStdin && sortStdin.write) {
      sortStdin.write('zebra\\n');
      sortStdin.write('apple\\n');
      sortStdin.write('banana\\n');
      sortStdin.end();
      console.log('  ✅ Wrote data to sort');
    } else {
      console.log('  ❌ No writable stdin');
    }
    
    const sortResult = await sortCmd;
    console.log('  📤 Result:', JSON.stringify(sortResult.stdout));
    
    console.log('\\n3️⃣ wc -l (counts lines from stdin)');
    const wcCmd = $`wc -l`;
    const wcStdin = await wcCmd.streams.stdin;
    console.log('  stdin type:', typeof wcStdin, 'has write?', !!(wcStdin && wcStdin.write));
    
    if (wcStdin && wcStdin.write) {
      wcStdin.write('line 1\\n');
      wcStdin.write('line 2\\n');
      wcStdin.write('line 3\\n');
      wcStdin.end();
      console.log('  ✅ Wrote data to wc');
    } else {
      console.log('  ❌ No writable stdin');
    }
    
    const wcResult = await wcCmd;
    console.log('  📤 Result:', JSON.stringify(wcResult.stdout.trim()));
    
    console.log('\\n4️⃣ tr (transforms text from stdin)');
    const trCmd = $`tr 'a-z' 'A-Z'`;
    const trStdin = await trCmd.streams.stdin;
    console.log('  stdin type:', typeof trStdin, 'has write?', !!(trStdin && trStdin.write));
    
    if (trStdin && trStdin.write) {
      trStdin.write('hello world\\n');
      trStdin.write('transform this\\n');
      trStdin.end();
      console.log('  ✅ Wrote data to tr');
    } else {
      console.log('  ❌ No writable stdin');
    }
    
    const trResult = await trCmd;
    console.log('  📤 Result:', JSON.stringify(trResult.stdout));
    
    console.log('\\n5️⃣ grep (filters stdin)');
    const grepCmd = $`grep "test"`;
    const grepStdin = await grepCmd.streams.stdin;
    console.log('  stdin type:', typeof grepStdin, 'has write?', !!(grepStdin && grepStdin.write));
    
    if (grepStdin && grepStdin.write) {
      grepStdin.write('no match here\\n');
      grepStdin.write('this is a test line\\n');
      grepStdin.write('skip this\\n');
      grepStdin.write('another test\\n');
      grepStdin.end();
      console.log('  ✅ Wrote data to grep');
    } else {
      console.log('  ❌ No writable stdin');
    }
    
    const grepResult = await grepCmd;
    console.log('  📤 Result:', JSON.stringify(grepResult.stdout));
    
    console.log('\\n📊 SUMMARY:');
    console.log('  The most reliable commands for stdin testing:');
    console.log('  ✅ cat, sort, wc, tr, grep - all read from stdin by default');
    console.log('  ✅ These never exit until stdin is closed');
    console.log('  ✅ Perfect for demonstrating streams.stdin control');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

reliableStdinCommands();