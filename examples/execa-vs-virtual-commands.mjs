#!/usr/bin/env node

// Demo: Virtual Commands Pipeline Examples
// Shows unique capabilities that execa cannot provide

import { $, register, execaCompat } from '../src/$.mjs';

console.log('🌟 Virtual Commands Pipeline Examples');
console.log('=====================================\n');

// Get execa-compatible API
const { execa } = execaCompat();

console.log('1. STANDARD EXECA APPROACH (System Commands Only)');
console.log('--------------------------------------------------');

try {
  // This would work with execa, but requires system commands
  const result1 = await execa('echo', ['Standard execa output']);
  console.log('✅ Execa result:', result1.stdout);
} catch (error) {
  console.log('❌ Execa failed:', error.message);
}

console.log('\n2. COMMAND-STREAM: VIRTUAL COMMANDS ENGINE');
console.log('-------------------------------------------');

// Register custom virtual commands
register('data-processor', async function(args) {
  const input = args[0] || 'no data';
  const processed = input.toUpperCase().split('').join(' ');
  return { stdout: processed, code: 0 };
});

register('json-formatter', async function(args, stdin) {
  const input = stdin || args.join(' ');
  try {
    const obj = { message: input, timestamp: new Date().toISOString() };
    return { stdout: JSON.stringify(obj, null, 2), code: 0 };
  } catch (error) {
    return { stderr: `JSON formatting error: ${error.message}`, code: 1 };
  }
});

register('word-count', async function(args, stdin) {
  const input = stdin || args.join(' ');
  const words = input.trim().split(/\s+/).length;
  const chars = input.length;
  const lines = input.split('\n').length;
  return { 
    stdout: `Lines: ${lines}, Words: ${words}, Characters: ${chars}`, 
    code: 0 
  };
});

// Virtual command pipeline - impossible with execa!
console.log('🚀 Virtual Pipeline Demo:');
try {
  const result2 = await $`data-processor "hello world" | json-formatter`;
  console.log('✅ Virtual pipeline result:');
  console.log(result2.stdout);
} catch (error) {
  console.log('❌ Virtual pipeline failed:', error.message);
}

console.log('\n3. MIXED PIPELINES (System + Virtual + Built-in)');
console.log('-------------------------------------------------');

try {
  // Mix system commands, virtual commands, and built-ins
  const result3 = await $`echo "processing data" | data-processor | word-count`;
  console.log('✅ Mixed pipeline result:', result3.stdout);
} catch (error) {
  console.log('❌ Mixed pipeline failed:', error.message);
}

console.log('\n4. REAL-TIME PROCESSING WITH VIRTUAL COMMANDS');
console.log('----------------------------------------------');

// Register a streaming virtual command
register('line-processor', async function*(args) {
  for (let i = 1; i <= 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 200)); // Simulate processing
    yield `Processed line ${i}: ${args.join(' ')}\n`;
  }
});

console.log('🔄 Streaming virtual command:');
try {
  const stream = $`line-processor "streaming data"`.stream();
  for await (const chunk of stream) {
    process.stdout.write(chunk.toString());
  }
} catch (error) {
  console.log('❌ Streaming failed:', error.message);
}

console.log('\n5. COMPLEX DATA TRANSFORMATION PIPELINE');
console.log('----------------------------------------');

// Register data transformation commands
register('csv-parser', async function(args, stdin) {
  const csvData = stdin || 'name,age,city\nJohn,30,NYC\nJane,25,LA';
  const lines = csvData.trim().split('\n');
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i];
      return obj;
    }, {});
  });
  return { stdout: JSON.stringify(rows, null, 2), code: 0 };
});

register('age-filter', async function(args, stdin) {
  const minAge = parseInt(args[0]) || 0;
  const data = JSON.parse(stdin);
  const filtered = data.filter(person => parseInt(person.age) >= minAge);
  return { stdout: JSON.stringify(filtered, null, 2), code: 0 };
});

console.log('📊 Data transformation pipeline:');
try {
  const csvData = 'name,age,city\nJohn,30,NYC\nJane,25,LA\nBob,35,SF\nAlice,22,Boston';
  const result4 = await $({ input: csvData })`csv-parser | age-filter 25`;
  console.log('✅ Data transformation result:');
  console.log(result4.stdout);
} catch (error) {
  console.log('❌ Data transformation failed:', error.message);
}

console.log('\n6. EXECA COMPATIBILITY WITH VIRTUAL ENHANCEMENT');
console.log('-----------------------------------------------');

// Show how execa-compatible API can still use virtual commands
console.log('🔄 Using execa API with virtual commands:');
try {
  const result5 = await execa('data-processor', ['execa-compatible']);
  console.log('✅ Execa + virtual result:', result5.stdout);
} catch (error) {
  console.log('❌ Execa + virtual failed:', error.message);
}

console.log('\n7. PERFORMANCE COMPARISON');
console.log('--------------------------');

// Benchmark: Virtual vs System commands
const iterations = 100;

console.log(`🏃 Performance test (${iterations} iterations):`);

// Virtual command performance
const startVirtual = Date.now();
for (let i = 0; i < iterations; i++) {
  await $`data-processor "test data ${i}"`;
}
const virtualTime = Date.now() - startVirtual;

// System command performance  
const startSystem = Date.now();
for (let i = 0; i < iterations; i++) {
  await $`echo "test data ${i}"`;
}
const systemTime = Date.now() - startSystem;

console.log(`✅ Virtual commands: ${virtualTime}ms (${virtualTime/iterations}ms avg)`);
console.log(`✅ System commands: ${systemTime}ms (${systemTime/iterations}ms avg)`);
console.log(`📈 Performance ratio: ${(systemTime/virtualTime).toFixed(2)}x`);

console.log('\n🎯 SUMMARY OF UNIQUE ADVANTAGES');
console.log('================================');
console.log('✅ Virtual Commands Engine - Create custom commands in JavaScript');
console.log('✅ Mixed Pipelines - Combine system + virtual + built-in commands');
console.log('✅ Real-time Streaming - Process data as it flows through pipeline');
console.log('✅ Zero Dependencies - Virtual commands work without system tools');
console.log('✅ Cross-platform - Same behavior everywhere');
console.log('✅ Performance - Often faster than spawning system processes');
console.log('✅ Programmable - Full JavaScript power in your commands');
console.log('✅ Execa Compatible - Drop-in replacement + enhanced features');

console.log('\n🚀 Command-Stream: Everything Execa Does + Revolutionary Virtual Commands!');