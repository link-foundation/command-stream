#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Realtime JSON Streaming Demo ===\n');
console.log('This demo shows that jq processes and outputs JSON objects immediately');
console.log('as they arrive, not waiting for the entire stream to complete.\n');
console.log('Watch the timestamps - each JSON object appears immediately after being generated!\n');
console.log('---\n');

// Example 1: Simple realtime streaming with visible delays
console.log('Example 1: Streaming with 1-second delays between each JSON object:');
console.log('Starting at:', new Date().toISOString());
console.log('');

const cmd1 = $`sh -c 'echo "{\\"event\\":\\"start\\",\\"time\\":\\"$(date +%H:%M:%S)\\"}"; sleep 1; echo "{\\"event\\":\\"middle\\",\\"time\\":\\"$(date +%H:%M:%S)\\"}"; sleep 1; echo "{\\"event\\":\\"end\\",\\"time\\":\\"$(date +%H:%M:%S)\\"}"' | jq -c .`;

for await (const chunk of cmd1.stream()) {
  if (chunk.type === 'stdout') {
    const timestamp = new Date().toISOString();
    process.stdout.write(`[${timestamp}] Received: ${chunk.data.toString()}`);
  }
}

console.log('\n---\n');

// Example 2: Processing server logs in realtime
console.log('Example 2: Simulating realtime server logs with filtering:');
console.log('(Only showing ERROR and WARN levels)\n');

const serverLogs = $`sh -c '
  echo "{\\"level\\":\\"INFO\\",\\"msg\\":\\"Server starting\\",\\"time\\":\\"$(date +%H:%M:%S)\\"}";
  sleep 0.5;
  echo "{\\"level\\":\\"ERROR\\",\\"msg\\":\\"Database connection failed\\",\\"time\\":\\"$(date +%H:%M:%S)\\"}";
  sleep 0.5;
  echo "{\\"level\\":\\"INFO\\",\\"msg\\":\\"Retrying connection\\",\\"time\\":\\"$(date +%H:%M:%S)\\"}";
  sleep 0.5;
  echo "{\\"level\\":\\"WARN\\",\\"msg\\":\\"High memory usage\\",\\"time\\":\\"$(date +%H:%M:%S)\\"}";
  sleep 0.5;
  echo "{\\"level\\":\\"INFO\\",\\"msg\\":\\"Connection restored\\",\\"time\\":\\"$(date +%H:%M:%S)\\"}";
' | jq -c 'select(.level == "ERROR" or .level == "WARN")'`;

let buffer = '';
for await (const chunk of serverLogs.stream()) {
  if (chunk.type === 'stdout') {
    buffer += chunk.data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const timestamp = new Date().toISOString();
          const log = JSON.parse(line.trim());
          console.log(`[${timestamp}] ${log.level}: ${log.msg} (generated at ${log.time})`);
        } catch (e) {
          console.log('Failed to parse:', line);
        }
      }
    }
  }
}

console.log('\n---\n');

// Example 3: Streaming metrics with transformation
console.log('Example 3: Streaming metrics with realtime transformation:');
console.log('(Adding status based on CPU value)\n');

const metrics = $`sh -c '
  for i in 1 2 3 4 5; do
    cpu=$((45 + RANDOM % 40));
    echo "{\\"metric\\":\\"cpu\\",\\"value\\":$cpu,\\"host\\":\\"server-$i\\",\\"time\\":\\"$(date +%H:%M:%S.%N | cut -b1-12)\\"}";
    sleep 0.3;
  done
' | jq -c '{metric, value, host, time, status: (if .value > 70 then "critical" elif .value > 50 then "warning" else "normal" end)}'`;

console.log('Monitoring CPU metrics (updates every 0.3 seconds):');
let metricsBuffer = '';
for await (const chunk of metrics.stream()) {
  if (chunk.type === 'stdout') {
    metricsBuffer += chunk.data.toString();
    const lines = metricsBuffer.split('\n');
    metricsBuffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const timestamp = new Date().toISOString();
          const metric = JSON.parse(line.trim());
          const statusIcon = metric.status === 'critical' ? '🔴' : metric.status === 'warning' ? '🟡' : '🟢';
          console.log(`[${timestamp}] ${statusIcon} ${metric.host}: CPU ${metric.value}% - ${metric.status}`);
        } catch (e) {
          console.log('Failed to parse metric:', line);
        }
      }
    }
  }
}

console.log('\n---\n');

// Example 4: Using EventEmitter pattern for realtime processing
console.log('Example 4: Using EventEmitter pattern for realtime JSON stream:');
console.log('(Shows different ways to handle streaming)\n');

const eventCmd = $`sh -c '
  for i in 1 2 3; do
    echo "{\\"id\\":$i,\\"data\\":\\"Message $i\\",\\"timestamp\\":$(date +%s)}";
    sleep 0.7;
  done
' | jq -c .`;

let eventCount = 0;
eventCmd
  .on('data', (chunk) => {
    eventCount++;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Event #${eventCount}: ${chunk.toString().trim()}`);
  })
  .on('end', (result) => {
    console.log(`\nStream completed. Total events: ${eventCount}`);
    console.log('Final result code:', result.code);
    
    console.log('\n=== Demo Complete ===');
  });