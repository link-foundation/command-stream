#!/usr/bin/env bun

// Emulate claude's streaming JSON output
// This simulates how claude outputs JSON objects incrementally

const events = [
  { type: 'start', message: 'Starting analysis...' },
  { type: 'progress', step: 1, message: 'Reading files...' },
  { type: 'data', content: 'Found main entry point' },
  { type: 'progress', step: 2, message: 'Analyzing dependencies...' },
  { type: 'data', content: 'Processing module imports' },
  { type: 'progress', step: 3, message: 'Building context...' },
  { type: 'result', summary: 'Analysis complete' },
  { type: 'end', status: 'success' }
];

async function* streamJsonEvents() {
  for (const event of events) {
    // Output JSON object
    console.log(JSON.stringify(event));
    
    // Small delay to simulate processing
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// Main execution
for await (const _ of streamJsonEvents()) {
  // Events are printed in the generator
}