#!/usr/bin/env node

// Demo: Async Iteration Examples 
// Shows streaming capabilities that execa cannot provide

import { $, execaCompat } from '../src/$.mjs';

console.log('🔄 Async Iteration Examples - Superior to Execa');
console.log('=================================================\n');

// Get execa-compatible API for comparison
const { execa } = execaCompat();

console.log('1. EXECA LIMITATION: Buffered Output Only');
console.log('------------------------------------------');

console.log('❌ Execa approach (must wait for completion):');
try {
  const start = Date.now();
  const result = await execa('echo', ['line1\nline2\nline3']);
  const duration = Date.now() - start;
  console.log(`   Complete result after ${duration}ms:`);
  console.log(`   ${result.stdout.replace(/\n/g, '\\n')}`);
  console.log('   ⚠️  No way to process data in real-time with execa\n');
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('2. COMMAND-STREAM: Real-time Async Iteration');
console.log('---------------------------------------------');

console.log('✅ Command-Stream approach (real-time processing):');
try {
  const start = Date.now();
  const stream = $`printf "line1\\nline2\\nline3\\n"`.stream();
  
  let lineCount = 0;
  for await (const chunk of stream) {
    const elapsed = Date.now() - start;
    const chunkStr = chunk.toString().trim();
    if (chunkStr) {
      lineCount++;
      console.log(`   [${elapsed}ms] Chunk ${lineCount}: "${chunkStr}"`);
    }
  }
  console.log(`   ✅ Processed ${lineCount} chunks in real-time!\n`);
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('3. PRACTICAL EXAMPLE: Processing Large Output');
console.log('----------------------------------------------');

console.log('🚀 Simulating large command output:');
try {
  // Simulate a command that produces output over time
  const stream = $`for i in {1..5}; do echo "Processing item $i"; sleep 0.1; done`.stream();
  
  const startTime = Date.now();
  let itemCount = 0;
  
  for await (const chunk of stream) {
    const elapsed = Date.now() - startTime;
    const line = chunk.toString().trim();
    if (line) {
      itemCount++;
      console.log(`   [${elapsed.toString().padStart(4, ' ')}ms] ${line}`);
      
      // Real-time decision making - impossible with execa!
      if (line.includes('item 3')) {
        console.log('   🎯 Detected item 3 - triggering real-time action!');
      }
    }
  }
  
  console.log(`   ✅ Processed ${itemCount} items with real-time feedback\n`);
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('4. STREAMING LOG ANALYSIS');
console.log('--------------------------');

console.log('📊 Real-time log processing:');
try {
  // Simulate log output
  const logStream = $`printf "INFO: Application started\\nWARN: Low memory\\nERROR: Connection failed\\nINFO: Retrying...\\n"`.stream();
  
  const stats = { info: 0, warn: 0, error: 0 };
  
  for await (const chunk of logStream) {
    const line = chunk.toString().trim();
    if (line) {
      if (line.startsWith('INFO:')) {
        stats.info++;
        console.log(`   ℹ️  ${line}`);
      } else if (line.startsWith('WARN:')) {
        stats.warn++;
        console.log(`   ⚠️  ${line}`);
      } else if (line.startsWith('ERROR:')) {
        stats.error++;
        console.log(`   ❌ ${line}`);
        // Real-time alerting
        console.log('   🚨 ALERT: Error detected - would send notification!');
      }
    }
  }
  
  console.log(`   📈 Final stats: ${stats.info} info, ${stats.warn} warnings, ${stats.error} errors\n`);
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('5. PROGRESS MONITORING');
console.log('-----------------------');

console.log('📋 Real-time progress tracking:');
try {
  const progressStream = $`for i in {1..10}; do echo "Progress: $((i*10))%"; sleep 0.05; done`.stream();
  
  let lastProgress = 0;
  for await (const chunk of progressStream) {
    const line = chunk.toString().trim();
    if (line && line.includes('Progress:')) {
      const match = line.match(/(\d+)%/);
      if (match) {
        const progress = parseInt(match[1]);
        const bar = '█'.repeat(progress / 10) + '░'.repeat(10 - progress / 10);
        console.log(`   [${bar}] ${progress}%`);
        lastProgress = progress;
      }
    }
  }
  console.log(`   ✅ Progress completed: ${lastProgress}%\n`);
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('6. EARLY TERMINATION & CONTROL');
console.log('--------------------------------');

console.log('🛑 Smart early termination:');
try {
  const searchStream = $`for i in {1..100}; do echo "Searching item $i"; sleep 0.01; done`.stream();
  
  let found = false;
  let itemsProcessed = 0;
  
  for await (const chunk of searchStream) {
    const line = chunk.toString().trim();
    if (line) {
      itemsProcessed++;
      console.log(`   🔍 ${line}`);
      
      // Smart termination - impossible with buffered execa!
      if (line.includes('item 7')) {
        console.log('   🎯 Found target item 7 - stopping search early!');
        found = true;
        break;
      }
      
      if (itemsProcessed >= 10) {
        console.log('   ⏰ Processed enough items - stopping early!');
        break;
      }
    }
  }
  
  console.log(`   📊 Processed ${itemsProcessed} items, found: ${found}\n`);
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('7. STREAMING DATA TRANSFORMATION');
console.log('---------------------------------');

console.log('🔄 Real-time data transformation:');
try {
  const dataStream = $`printf "apple\\nbanana\\ncherry\\ndate\\neggplant\\n"`.stream();
  
  const processed = [];
  for await (const chunk of dataStream) {
    const item = chunk.toString().trim();
    if (item) {
      // Transform data in real-time
      const transformed = {
        original: item,
        length: item.length,
        uppercase: item.toUpperCase(),
        vowels: (item.match(/[aeiou]/gi) || []).length
      };
      processed.push(transformed);
      console.log(`   ✨ Transformed: ${JSON.stringify(transformed)}`);
    }
  }
  
  console.log(`   📈 Processed ${processed.length} items in real-time\n`);
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('8. MEMORY EFFICIENCY COMPARISON');
console.log('--------------------------------');

console.log('💾 Memory efficiency demo:');

// Simulate processing large amount of data
console.log('   Command-Stream (streaming): Constant memory usage');
try {
  const largeStream = $`for i in {1..1000}; do echo "Large data chunk $i with lots of content"; done`.stream();
  
  let totalProcessed = 0;
  let chunkCount = 0;
  
  for await (const chunk of largeStream) {
    const line = chunk.toString();
    totalProcessed += line.length;
    chunkCount++;
    
    if (chunkCount % 100 === 0) {
      console.log(`   📊 Processed ${chunkCount} chunks, ${totalProcessed} bytes (constant memory)`);
    }
    
    if (chunkCount >= 200) break; // Demo purposes
  }
  
  console.log(`   ✅ Processed ${chunkCount} chunks efficiently\n`);
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('❌ Execa equivalent would buffer everything in memory first!');
console.log('   - Must wait for ALL output before processing');
console.log('   - Memory usage = total output size');
console.log('   - No real-time feedback or control\n');

console.log('9. EVENT-DRIVEN PROCESSING');
console.log('---------------------------');

console.log('⚡ Event-driven async iteration:');
try {
  const eventStream = $`printf "EVENT:start\\nDATA:item1\\nDATA:item2\\nEVENT:middle\\nDATA:item3\\nEVENT:end\\n"`.stream();
  
  let currentSection = 'init';
  const sections = { init: [], start: [], middle: [], end: [] };
  
  for await (const chunk of eventStream) {
    const line = chunk.toString().trim();
    if (line) {
      if (line.startsWith('EVENT:')) {
        currentSection = line.split(':')[1];
        console.log(`   🎪 Section changed to: ${currentSection}`);
      } else if (line.startsWith('DATA:')) {
        const data = line.split(':')[1];
        sections[currentSection].push(data);
        console.log(`   📦 Added data to ${currentSection}: ${data}`);
      }
    }
  }
  
  console.log('   📊 Final sections:', sections);
  console.log('   ✅ Event-driven processing complete!\n');
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('🎯 ASYNC ITERATION ADVANTAGES SUMMARY');
console.log('======================================');
console.log('✅ Real-time Processing - Process data as it streams');
console.log('✅ Early Termination - Stop processing when condition met');
console.log('✅ Progress Monitoring - Track progress in real-time');
console.log('✅ Memory Efficiency - Constant memory usage vs buffering');
console.log('✅ Interactive Control - Make decisions during execution');
console.log('✅ Event-driven Logic - Respond to data patterns immediately');
console.log('✅ Streaming Analytics - Analyze data as it flows');
console.log('✅ Live Feedback - Provide immediate user feedback');

console.log('\n❌ WHAT EXECA CANNOT DO:');
console.log('========================');
console.log('❌ No real-time processing - must wait for completion');  
console.log('❌ No early termination - always processes everything');
console.log('❌ No progress monitoring - binary done/not-done');
console.log('❌ High memory usage - buffers all output');
console.log('❌ No interactive control - fire-and-forget only');
console.log('❌ No streaming analytics - batch processing only');

console.log('\n🚀 Command-Stream: Streaming Superpowers That Beat Execa!');