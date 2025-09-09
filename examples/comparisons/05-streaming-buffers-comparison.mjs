#!/usr/bin/env node
/**
 * Streaming Buffers Interface: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates buffer access and binary data handling
 * working identically in both Node.js and Bun.js runtimes.
 */

import { $ } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function streamingBuffersComparison() {
  try {
    console.log('1️⃣  Basic Buffer Access:');
    
    const cmd1 = $`echo "Binary data test"`;
    const buffer = await cmd1.buffers.stdout;
    
    console.log(`   Buffer length: ${buffer.length} bytes`);
    console.log(`   Buffer content: "${buffer.toString().trim()}"`);
    console.log(`   Buffer type: ${buffer.constructor.name}`);

    console.log('\n2️⃣  Mixed Stdout/Stderr Buffers:');
    
    const cmd2 = $`sh -c 'echo "stdout data"; echo "stderr data" >&2'`;
    const [stdoutBuf, stderrBuf] = await Promise.all([
      cmd2.buffers.stdout,
      cmd2.buffers.stderr
    ]);
    
    console.log(`   Stdout buffer: "${stdoutBuf.toString().trim()}" (${stdoutBuf.length} bytes)`);
    console.log(`   Stderr buffer: "${stderrBuf.toString().trim()}" (${stderrBuf.length} bytes)`);

    console.log('\n3️⃣  Large Data Buffer Handling:');
    
    const cmd3 = $`seq 1 20`;
    const largeBuf = await cmd3.buffers.stdout;
    const lines = largeBuf.toString().split('\n').filter(l => l.trim());
    
    console.log(`   Large buffer: ${largeBuf.length} bytes, ${lines.length} lines`);
    console.log(`   First line: "${lines[0]}", Last line: "${lines[lines.length - 1]}"`);

    console.log('\n4️⃣  Pipeline Buffer Output:');
    
    const cmd4 = $`echo -e "apple\nbanana\ncherry" | sort`;
    const pipelineBuf = await cmd4.buffers.stdout;
    const sortedLines = pipelineBuf.toString().trim().split('\n');
    
    console.log(`   Pipeline buffer: ${pipelineBuf.length} bytes`);
    console.log(`   Sorted output: ${sortedLines.join(', ')}`);

    console.log('\n5️⃣  Binary Data Simulation:');
    
    // Simulate binary data by using od command (if available) or cat with special chars
    const cmd5 = $`printf "\\x41\\x42\\x43\\x0A"`;  // ABC\n in hex
    const binaryBuf = await cmd5.buffers.stdout;
    
    console.log(`   Binary buffer: ${binaryBuf.length} bytes`);
    console.log(`   Hex representation: ${Array.from(binaryBuf).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    console.log(`   ASCII representation: "${binaryBuf.toString().trim()}"`);

    console.log('\n6️⃣  Buffer vs String Comparison:');
    
    const cmd6 = $`echo "Compare buffer and string"`;
    const [bufResult, strResult] = await Promise.all([
      cmd6.buffers.stdout,
      cmd6.strings.stdout
    ]);
    
    console.log(`   Buffer result: ${typeof bufResult} (${bufResult.length} bytes)`);
    console.log(`   String result: ${typeof strResult} (${strResult.length} chars)`);
    console.log(`   Content match: ${bufResult.toString() === strResult ? '✅' : '❌'}`);

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All buffer access patterns work perfectly in ${runtime}!`);
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    process.exit(1);
  }
}

streamingBuffersComparison();