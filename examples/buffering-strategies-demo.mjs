#!/usr/bin/env bun

// Buffering Strategies Demo - Batching and windowing

import { $ } from '../src/$.mjs';

console.log('📦 Buffering Strategies Demo - Batch Processing & Windows\n');

// Example 1: Batch processing with size-based batching
console.log('🗂️ Example 1: Size-based batching');
console.log('Processing data in batches of 3 items...\n');

try {
  const batched = $`seq 1 10`.batch(3);

  console.log('Batch processing results:');
  let batchNum = 1;
  for await (const batch of batched) {
    const items = batch.data.map(chunk => chunk.data.toString().trim());
    console.log(`├─ Batch ${batchNum++}: [${items.join(', ')}] (${batch.size} items)`);
  }
  console.log('✅ Batch processing completed\n');

} catch (error) {
  console.error('❌ Batch demo failed:', error.message);
}

// Example 2: Time-based batching
console.log('⏱️ Example 2: Time-based batching');
console.log('Batching with 500ms time window...\n');

try {
  // Generate data with delays to demonstrate time-based batching
  const timeBasedBatched = $`sh -c 'for i in {1..8}; do echo "Message $i"; sleep 0.2; done'`
    .batch(5, 500); // Max 5 items OR 500ms timeout

  console.log('Time-based batch results:');
  let batchNum = 1;
  for await (const batch of timeBasedBatched) {
    const items = batch.data.map(chunk => chunk.data.toString().trim());
    const timestamp = new Date(batch.timestamp).toLocaleTimeString();
    console.log(`├─ Batch ${batchNum++} [${timestamp}]: [${items.join(', ')}] (${batch.size} items)`);
  }
  console.log('✅ Time-based batching completed\n');

} catch (error) {
  console.error('❌ Time-based batch demo failed:', error.message);
}

// Example 3: Sliding window processing
console.log('🪟 Example 3: Sliding window analysis');
console.log('Analyzing data with a sliding window of 3 items...\n');

try {
  const windowed = $`seq 1 8`.slidingWindow(3);

  console.log('Sliding window analysis:');
  let windowNum = 1;
  for await (const window of windowed) {
    const items = window.data.map(chunk => chunk.data.toString().trim());
    const sum = items.reduce((acc, val) => acc + parseInt(val), 0);
    const avg = (sum / items.length).toFixed(1);
    console.log(`├─ Window ${windowNum++}: [${items.join(', ')}] → sum: ${sum}, avg: ${avg}`);
  }
  console.log('✅ Sliding window analysis completed\n');

} catch (error) {
  console.error('❌ Sliding window demo failed:', error.message);
}

// Example 4: Advanced batch processing with transforms
console.log('⚡ Example 4: Advanced batch processing with transforms');
console.log('Combining batching with map/filter operations...\n');

try {
  const advancedBatched = $`seq 1 12`
    .map(line => parseInt(line.trim()) * 2)  // Double each number
    .filter(line => parseInt(line) > 10)      // Filter > 10
    .batch(3);                               // Batch in groups of 3

  console.log('Advanced batch processing:');
  let batchNum = 1;
  for await (const batch of advancedBatched) {
    const items = batch.data.map(chunk => chunk.data.toString().trim());
    const numbers = items.map(x => parseInt(x));
    const sum = numbers.reduce((a, b) => a + b, 0);
    console.log(`├─ Batch ${batchNum++}: [${items.join(', ')}] → sum: ${sum}`);
  }
  console.log('✅ Advanced processing completed\n');

} catch (error) {
  console.error('❌ Advanced demo failed:', error.message);
}

// Example 5: Real-world use case - Log aggregation
console.log('🏭 Example 5: Real-world log aggregation');
console.log('Aggregating log entries by time windows...\n');

try {
  const logAggregation = $`sh -c 'for i in {1..15}; do
    level=$([ $((i % 3)) -eq 0 ] && echo "ERROR" || echo "INFO")
    echo "[$level] $(date +%H:%M:%S.%3N) Event $i occurred"
    sleep 0.1
  done'`
    .batch(4, 800) // Batch every 4 logs or 800ms
    .map(async batch => {
      const logs = batch.data.map(chunk => chunk.data.toString().trim());
      const errorCount = logs.filter(log => log.includes('ERROR')).length;
      const infoCount = logs.filter(log => log.includes('INFO')).length;
      
      return {
        timestamp: new Date(batch.timestamp).toLocaleTimeString(),
        totalLogs: logs.length,
        errorCount,
        infoCount,
        errorRate: (errorCount / logs.length * 100).toFixed(1)
      };
    });

  console.log('Log aggregation results:');
  let aggregateNum = 1;
  for await (const chunk of logAggregation) {
    const summary = JSON.parse(chunk.data.toString());
    console.log(`├─ Aggregate ${aggregateNum++} [${summary.timestamp}]:`);
    console.log(`   ├─ Total logs: ${summary.totalLogs}`);
    console.log(`   ├─ Errors: ${summary.errorCount}, Info: ${summary.infoCount}`);
    console.log(`   └─ Error rate: ${summary.errorRate}%`);
  }
  console.log('✅ Log aggregation completed\n');

} catch (error) {
  console.error('❌ Log aggregation demo failed:', error.message);
}

console.log('🎯 Buffering strategies demo completed successfully!');
console.log('💡 Key features demonstrated:');
console.log('  • Size-based batching for bulk processing');
console.log('  • Time-based batching for real-time aggregation');
console.log('  • Sliding window analysis for trend monitoring');
console.log('  • Advanced pipeline combinations');
console.log('  • Real-world log aggregation patterns');