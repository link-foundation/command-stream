#!/usr/bin/env bun

// Stream Merging Demo - Combining multiple data streams

import { $, merge } from '../src/$.mjs';

console.log('🔀 Stream Merging Demo - Multi-source Processing\n');

// Example 1: Basic stream merging
console.log('📡 Example 1: Merging multiple log sources');
console.log('Combining output from different system monitors...\n');

try {
  const systemMonitor = $`sh -c 'for i in {1..5}; do echo "SYSTEM: CPU usage at $((60 + RANDOM % 40))%"; sleep 0.2; done'`;
  const networkMonitor = $`sh -c 'for i in {1..5}; do echo "NETWORK: $((100 + RANDOM % 200))ms latency to server"; sleep 0.15; done'`;
  const diskMonitor = $`sh -c 'for i in {1..5}; do echo "DISK: $((40 + RANDOM % 60))% usage on /var"; sleep 0.25; done'`;

  const merged = merge(systemMonitor, networkMonitor, diskMonitor);

  console.log('Combined monitoring streams:');
  for await (const chunk of merged) {
    const source = ['System', 'Network', 'Disk'][chunk.streamIndex];
    const timestamp = new Date(chunk.timestamp).toLocaleTimeString();
    console.log(`[${timestamp}] ${source}: ${chunk.data.toString().trim()}`);
  }
  console.log('✅ Stream merging completed\n');

} catch (error) {
  console.error('❌ Merging demo failed:', error.message);
}

// Example 2: Merging with analytics
console.log('📊 Example 2: Analytics across merged streams');
console.log('Analyzing combined data from multiple sources...\n');

try {
  const errorLogs = $`sh -c 'for i in {1..8}; do echo "Service A: ERROR - Connection timeout"; sleep 0.1; done'`;
  const infoLogs = $`sh -c 'for i in {1..12}; do echo "Service B: INFO - Request processed"; sleep 0.08; done'`;
  const warnLogs = $`sh -c 'for i in {1..6}; do echo "Service C: WARN - Memory usage high"; sleep 0.15; done'`;

  const mergedWithAnalytics = merge(errorLogs, infoLogs, warnLogs)
    .analyze({
      errorRate: (line, streamIndex) => line.includes('ERROR')
    });

  console.log('Merged stream analytics:');
  let count = 0;
  for await (const chunk of mergedWithAnalytics) {
    if (chunk.analytics && ++count % 8 === 0) { // Show every 8th update
      const analytics = chunk.analytics;
      console.log(`├─ Update ${count}:`);
      console.log(`   ├─ Stream distribution: [${analytics.streamCounts.join(', ')}]`);
      console.log(`   ├─ Total messages: ${analytics.totalCount}`);
      console.log(`   ├─ Error rates: [${analytics.errorRates.join(', ')}]`);
      console.log(`   └─ Dominant stream: ${analytics.dominantStream} (${['Error', 'Info', 'Warn'][analytics.dominantStream]})`);
    }
  }
  console.log('✅ Analytics completed\n');

} catch (error) {
  console.error('❌ Analytics demo failed:', error.message);
}

console.log('🎯 Stream merging demo completed successfully!');
console.log('💡 Key features demonstrated:');
console.log('  • Multi-stream merging with timestamps');
console.log('  • Stream-aware analytics');
console.log('  • Real-time monitoring of multiple sources');
console.log('  • Distribution analysis across streams');