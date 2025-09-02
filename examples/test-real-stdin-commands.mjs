#!/usr/bin/env node

/**
 * Test commands that actually read and respond to stdin
 */

import { $ } from '../src/$.mjs';

console.log('=== Testing commands that ACTUALLY read stdin ===');
console.log('');

async function testRealStdinCommands() {
  try {
    console.log('TEST 1: cat - classic stdin reader');
    
    const catCmd = $`cat`;
    const stdin1 = catCmd.streams.stdin;
    
    if (stdin1) {
      stdin1.write('Hello from stdin!\\n');
      stdin1.write('Second line\\n');
      stdin1.end();
    }
    
    const result1 = await catCmd;
    console.log('✓ cat result:', JSON.stringify(result1.stdout));
    console.log('  Exit code:', result1.code);
    
    console.log('\\nTEST 2: grep - filter input from stdin');
    
    const grepCmd = $`grep "hello"`;
    const stdin2 = grepCmd.streams.stdin;
    
    if (stdin2) {
      stdin2.write('this line has no match\\n');
      stdin2.write('hello world\\n');
      stdin2.write('another non-match\\n');
      stdin2.write('hello again\\n');
      stdin2.end();
    }
    
    const result2 = await grepCmd;
    console.log('✓ grep result:', JSON.stringify(result2.stdout));
    console.log('  Exit code:', result2.code);
    
    console.log('\\nTEST 3: sort - sort input from stdin');
    
    const sortCmd = $`sort`;
    const stdin3 = sortCmd.streams.stdin;
    
    if (stdin3) {
      stdin3.write('zebra\\n');
      stdin3.write('apple\\n');
      stdin3.write('banana\\n');
      stdin3.end();
    }
    
    const result3 = await sortCmd;
    console.log('✓ sort result:', JSON.stringify(result3.stdout));
    console.log('  Exit code:', result3.code);
    
    console.log('\\nTEST 4: wc - count lines from stdin');
    
    const wcCmd = $`wc -l`;
    const stdin4 = wcCmd.streams.stdin;
    
    if (stdin4) {
      stdin4.write('line 1\\n');
      stdin4.write('line 2\\n');
      stdin4.write('line 3\\n');
      stdin4.end();
    }
    
    const result4 = await wcCmd;
    console.log('✓ wc result:', JSON.stringify(result4.stdout.trim()));
    console.log('  Exit code:', result4.code);
    
    console.log('\\nTEST 5: tr - transform text from stdin');
    
    const trCmd = $`tr 'a-z' 'A-Z'`; // Convert lowercase to uppercase
    const stdin5 = trCmd.streams.stdin;
    
    if (stdin5) {
      stdin5.write('hello world\\n');
      stdin5.write('this is lowercase\\n');
      stdin5.end();
    }
    
    const result5 = await trCmd;
    console.log('✓ tr result:', JSON.stringify(result5.stdout));
    console.log('  Exit code:', result5.code);
    
    console.log('\\nTEST 6: awk - process stdin with awk');
    
    const awkCmd = $`awk '{print NR ": " $0}'`; // Add line numbers
    const stdin6 = awkCmd.streams.stdin;
    
    if (stdin6) {
      stdin6.write('first line\\n');
      stdin6.write('second line\\n');
      stdin6.write('third line\\n');
      stdin6.end();
    }
    
    const result6 = await awkCmd;
    console.log('✓ awk result:', JSON.stringify(result6.stdout));
    console.log('  Exit code:', result6.code);
    
    console.log('\\nTEST 7: head - limit lines from stdin');
    
    const headCmd = $`head -n 2`;
    const stdin7 = headCmd.streams.stdin;
    
    if (stdin7) {
      stdin7.write('line 1\\n');
      stdin7.write('line 2\\n');
      stdin7.write('line 3\\n');
      stdin7.write('line 4\\n');
      stdin7.end();
    }
    
    const result7 = await headCmd;
    console.log('✓ head result:', JSON.stringify(result7.stdout));
    console.log('  Exit code:', result7.code);
    
    console.log('\\nTEST 8: Interactive command - bc calculator');
    
    const bcCmd = $`bc -l`;
    const stdin8 = bcCmd.streams.stdin;
    
    if (stdin8) {
      stdin8.write('2 + 3\\n');
      stdin8.write('10 * 5\\n');
      stdin8.write('sqrt(16)\\n');
      stdin8.write('quit\\n'); // Important: quit to exit bc
    }
    
    const result8 = await bcCmd;
    console.log('✓ bc result:', JSON.stringify(result8.stdout));
    console.log('  Exit code:', result8.code);
    
    console.log('\\n✅ SUMMARY:');
    console.log('  • All these commands actually READ and PROCESS stdin input');
    console.log('  • They demonstrate real stdin control, not just timing coincidences');  
    console.log('  • These are the types of commands where streams.stdin is genuinely useful');
    console.log('  • Commands like ping, top (without quit) ignore stdin - use kill() for those');
    
  } catch (error) {
    console.log('\\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testRealStdinCommands();