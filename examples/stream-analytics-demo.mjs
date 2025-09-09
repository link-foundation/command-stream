#!/usr/bin/env bun

// Stream Analytics Demo - Real-time monitoring and metrics

import { $ } from '../src/$.mjs';

console.log('🚀 Stream Analytics Demo - Real-time Processing Engine\n');

// Example 1: Log monitoring with analytics
console.log('📊 Example 1: Real-time log analytics');
console.log('Generating sample log data with errors and response times...\n');

try {
  const stats = await $`sh -c 'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do 
    if [ $((i % 4)) -eq 0 ]; then 
      echo "ERROR: Failed to process request $i - response time: $((100 + i * 20))ms"
    else 
      echo "INFO: Request $i processed successfully - response time: $((200 + i * 15))ms"
    fi
    sleep 0.1
  done'`
    .analyze({
      errorRate: line => line.includes('ERROR'),
      responseTime: line => {
        const match = line.match(/response time: (\d+)ms/);
        return match ? parseInt(match[1]) : null;
      },
      throughput: true,
      customMetrics: {
        requestCount: (line, analytics) => {
          const match = line.match(/Request (\d+)/);
          return match ? parseInt(match[1]) : undefined;
        },
        severity: (line) => {
          if (line.includes('ERROR')) return 'high';
          if (line.includes('WARN')) return 'medium';
          return 'low';
        }
      }
    });

  console.log('Real-time analytics results:');
  let chunkCount = 0;
  for await (const chunk of stats) {
    if (chunk.analytics && ++chunkCount % 5 === 0) { // Show every 5th analytics update
      console.log(`├─ Chunk ${chunkCount}:`, {
        errorRate: chunk.analytics.errorRate,
        avgResponseTime: Math.round(chunk.analytics.avgResponseTime),
        throughputRate: Math.round(chunk.analytics.throughputRate),
        elapsedTime: chunk.analytics.elapsedTime,
        customMetrics: Object.keys(chunk.analytics.customMetrics)
      });
    }
  }
  console.log('✅ Log analytics completed\n');

} catch (error) {
  console.error('❌ Analytics demo failed:', error.message);
}

// Example 2: Stream transforms - processing pipeline
console.log('🔄 Example 2: Stream transformation pipeline');
console.log('Processing data through map → filter → reduce operations...\n');

try {
  // Create a data processing pipeline
  const pipeline = $`seq 1 10`.map(line => {
    const num = parseInt(line.trim());
    return `processed_${num * 2}`;
  }).filter(line => {
    const num = parseInt(line.split('_')[1]);
    return num > 10; // Only keep numbers > 10
  });

  console.log('Filtered and mapped results:');
  for await (const chunk of pipeline) {
    console.log(`├─ ${chunk.data.toString().trim()}`);
  }

  // Demonstrate reduce operation
  const sum = await $`seq 1 5`.reduce((acc, line) => {
    return acc + parseInt(line.trim());
  }, 0).aggregate();

  console.log(`└─ Sum of 1-5: ${sum}\n`);

} catch (error) {
  console.error('❌ Transform demo failed:', error.message);
}

// Example 3: Stream splitting
console.log('🌿 Example 3: Stream splitting based on content');
console.log('Splitting mixed log levels into separate streams...\n');

try {
  const mixedLogs = $`sh -c 'echo "INFO: System started"; echo "ERROR: Connection failed"; echo "WARN: Low memory"; echo "INFO: User logged in"; echo "ERROR: Database timeout"'`;
  
  const split = mixedLogs.split(line => line.includes('ERROR'));

  console.log('Error stream:');
  for await (const chunk of split.matched) {
    console.log(`🚨 ${chunk.data.toString().trim()}`);
  }

  console.log('\nInfo/Warning stream:');
  for await (const chunk of split.unmatched) {
    console.log(`ℹ️  ${chunk.data.toString().trim()}`);
  }
  console.log('');

} catch (error) {
  console.error('❌ Splitting demo failed:', error.message);
}

console.log('🎯 Stream analytics demo completed successfully!');
console.log('💡 Key features demonstrated:');
console.log('  • Real-time error rate monitoring');
console.log('  • Response time analysis');
console.log('  • Custom metrics collection'); 
console.log('  • Stream transformations (map/filter/reduce)');
console.log('  • Content-based stream splitting');