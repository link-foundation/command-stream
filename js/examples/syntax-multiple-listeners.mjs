#!/usr/bin/env node

// Multiple event listeners comparison

import { $ } from '../js/src/$.mjs';

console.log('Multiple event listeners comparison:');

console.log('Regular $ with multiple listeners:');
try {
  const multiRunner1 = $`echo -e "Event 1\\nEvent 2\\nEvent 3"`;

  // First listener - counts events
  let eventCount1 = 0;
  multiRunner1.on('stdout', (data) => {
    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim());
    eventCount1 += lines.length;
  });

  // Second listener - processes events
  multiRunner1.on('stdout', (data) => {
    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim());
    for (const line of lines) {
      console.log(`📨 Regular listener: ${line}`);
    }
  });

  // Third listener - logs timing
  const start1 = Date.now();
  multiRunner1.on('close', () => {
    const duration = Date.now() - start1;
    console.log(
      `⏰ Regular $ processed ${eventCount1} events in ${duration}ms`
    );
  });

  await multiRunner1;
} catch (error) {
  console.log(`Error: ${error.message}`);
}

console.log('\nConfigured $ with multiple listeners:');
const $multiConfig = $({ mirror: false });

try {
  const multiRunner2 = $multiConfig`echo -e "Config Event 1\\nConfig Event 2\\nConfig Event 3"`;

  // First listener - counts events
  let eventCount2 = 0;
  multiRunner2.on('stdout', (data) => {
    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim());
    eventCount2 += lines.length;
  });

  // Second listener - processes events
  multiRunner2.on('stdout', (data) => {
    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim());
    for (const line of lines) {
      console.log(`📨 Configured listener: ${line}`);
    }
  });

  // Third listener - logs timing
  const start2 = Date.now();
  multiRunner2.on('close', () => {
    const duration = Date.now() - start2;
    console.log(
      `⏰ Configured $ processed ${eventCount2} events in ${duration}ms`
    );
  });

  await multiRunner2;
} catch (error) {
  console.log(`Error: ${error.message}`);
}
