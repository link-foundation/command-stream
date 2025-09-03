#!/usr/bin/env node

/**
 * Test the README examples to ensure they work correctly
 */

import { $ } from '../src/$.mjs';

console.log('🧪 Testing README Examples');
console.log('='.repeat(40));

async function testReadmeExamples() {
  try {
    
    console.log('\n📝 EXAMPLE 1: Send data via streams.stdin with cat');
    console.log('─'.repeat(30));
    
    const catCmd = $`cat`;
    const stdin = await catCmd.streams.stdin;
    
    if (stdin && stdin.write) {
      console.log('✅ Got writable stdin stream');
      stdin.write('Hello from stdin!\n');
      stdin.write('Multiple lines work!\n');
      stdin.end();
      
      const result = await catCmd;
      console.log('✅ Cat output:', JSON.stringify(result.stdout));
    } else {
      console.log('❌ No writable stdin available');
    }
    
    console.log('\n🔧 EXAMPLE 2: Filter data with grep');
    console.log('─'.repeat(30));
    
    const grepCmd = $`grep "important"`;
    const grepStdin = await grepCmd.streams.stdin;
    
    if (grepStdin && grepStdin.write) {
      console.log('✅ Got writable grep stdin stream');
      grepStdin.write('ignore this line\n');
      grepStdin.write('important message 1\n');
      grepStdin.write('skip this too\n');
      grepStdin.write('another important note\n');
      grepStdin.end();
      
      const grepResult = await grepCmd;
      console.log('✅ Grep filtered output:', JSON.stringify(grepResult.stdout));
    } else {
      console.log('❌ No writable grep stdin available');
    }
    
    console.log('\n📊 EXAMPLE 3: Sort data via stdin');
    console.log('─'.repeat(30));
    
    const sortCmd = $`sort`;
    const sortStdin = await sortCmd.streams.stdin;
    
    if (sortStdin && sortStdin.write) {
      console.log('✅ Got writable sort stdin stream');
      sortStdin.write('zebra\n');
      sortStdin.write('apple\n');
      sortStdin.write('banana\n');
      sortStdin.write('cherry\n');
      sortStdin.end();
      
      const sortResult = await sortCmd;
      console.log('✅ Sort result:', JSON.stringify(sortResult.stdout));
    } else {
      console.log('❌ No writable sort stdin available');
    }
    
    console.log('\n🧮 EXAMPLE 4: Calculator with bc (if available)');
    console.log('─'.repeat(30));
    
    try {
      const calcCmd = $`bc -l`;
      const calcStdin = await calcCmd.streams.stdin;
      
      if (calcStdin && calcStdin.write) {
        console.log('✅ Got writable bc stdin stream');
        calcStdin.write('scale=2\n');
        calcStdin.write('10 / 3\n');
        calcStdin.write('sqrt(16)\n');
        calcStdin.write('quit\n');
        
        const calcResult = await calcCmd;
        console.log('✅ BC calculation results:', JSON.stringify(calcResult.stdout.trim()));
      } else {
        console.log('❌ No writable bc stdin available');
      }
    } catch (error) {
      console.log('⚠️ BC not available or failed:', error.message);
    }
    
    console.log('\n🔄 EXAMPLE 5: Text transformation with tr');
    console.log('─'.repeat(30));
    
    const trCmd = $`tr 'a-z' 'A-Z'`;
    const trStdin = await trCmd.streams.stdin;
    
    if (trStdin && trStdin.write) {
      console.log('✅ Got writable tr stdin stream');
      trStdin.write('hello world\n');
      trStdin.write('this is lowercase text\n');
      trStdin.end();
      
      const trResult = await trCmd;
      console.log('✅ TR transformed text:', JSON.stringify(trResult.stdout));
    } else {
      console.log('❌ No writable tr stdin available');
    }
    
    console.log('\n⚡ EXAMPLE 6: Process control with kill()');
    console.log('─'.repeat(30));
    
    const sleepCmd = $`sleep 5`;
    
    // Kill after 1 second
    setTimeout(() => {
      console.log('🔪 Using kill() to stop sleep command...');
      sleepCmd.kill();
    }, 1000);
    
    const sleepResult = await sleepCmd;
    console.log('✅ Sleep killed with exit code:', sleepResult.code);
    
    console.log('\n' + '='.repeat(40));
    console.log('🎉 README EXAMPLES TEST COMPLETED!');
    
  } catch (error) {
    console.log('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testReadmeExamples();