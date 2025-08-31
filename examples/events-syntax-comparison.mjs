#!/usr/bin/env node

// Side-by-side comparison of event handling: regular $ vs $({ options })

import { $ } from '../src/$.mjs';

console.log('=== Event Handling Syntax Comparison ===\n');

// Example 1: Basic event handling comparison
console.log('1. Basic event handling comparison:');

console.log('   Regular $ syntax:');
try {
  const runner1 = $`echo -e "Output line 1\\nOutput line 2\\nOutput line 3"`;
  
  let regularCount = 0;
  
  runner1.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      regularCount++;
      console.log(`   📝 Regular #${regularCount}: ${line}`);
    }
  });
  
  runner1.on('close', () => {
    console.log(`   ✅ Regular $ completed with ${regularCount} lines`);
  });
  
  await runner1;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   $({ options }) syntax with mirror: false:');
const $configured = $({ mirror: false });

try {
  const runner2 = $configured`echo -e "Configured line 1\\nConfigured line 2\\nConfigured line 3"`;
  
  let configuredCount = 0;
  
  runner2.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      configuredCount++;
      console.log(`   ⚙️  Configured #${configuredCount}: ${line}`);
    }
  });
  
  runner2.on('close', () => {
    console.log(`   ✅ Configured $ completed with ${configuredCount} lines`);
  });
  
  await runner2;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 2: Error handling comparison
console.log('2. Error handling comparison:');

console.log('   Regular $ error handling:');
try {
  const errorRunner1 = $`bash -c 'echo "Success message"; echo "Error message" >&2; exit 1'`;
  
  let stdoutReceived = false;
  let stderrReceived = false;
  
  errorRunner1.on('stdout', (data) => {
    stdoutReceived = true;
    console.log(`   📤 Regular stdout: ${data.toString().trim()}`);
  });
  
  errorRunner1.on('stderr', (data) => {
    stderrReceived = true;
    console.log(`   🚨 Regular stderr: ${data.toString().trim()}`);
  });
  
  errorRunner1.on('close', (exitCode) => {
    console.log(`   🔚 Regular $ closed with exit code: ${exitCode}`);
    console.log(`   📊 Stdout: ${stdoutReceived}, Stderr: ${stderrReceived}`);
  });
  
  try {
    await errorRunner1;
  } catch (error) {
    console.log(`   ⚠️  Regular $ caught error: ${error.message}`);
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   Configured $ error handling:');
const $errorConfig = $({ mirror: false, capture: true });

try {
  const errorRunner2 = $errorConfig`bash -c 'echo "Success message"; echo "Error message" >&2; exit 1'`;
  
  let configStdout = false;
  let configStderr = false;
  
  errorRunner2.on('stdout', (data) => {
    configStdout = true;
    console.log(`   📤 Configured stdout: ${data.toString().trim()}`);
  });
  
  errorRunner2.on('stderr', (data) => {
    configStderr = true;
    console.log(`   🚨 Configured stderr: ${data.toString().trim()}`);
  });
  
  errorRunner2.on('close', (exitCode) => {
    console.log(`   🔚 Configured $ closed with exit code: ${exitCode}`);
    console.log(`   📊 Stdout: ${configStdout}, Stderr: ${configStderr}`);
  });
  
  try {
    const result = await errorRunner2;
    console.log(`   💾 Captured stdout: "${result.stdout.trim()}"`);
    console.log(`   💾 Captured stderr: "${result.stderr.trim()}"`);
  } catch (error) {
    console.log(`   ⚠️  Configured $ caught error: ${error.message}`);
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 3: Timing and performance comparison
console.log('3. Timing and performance comparison:');

const testCommand = 'for i in {1..5}; do echo "Message $i"; sleep 0.1; done';

console.log('   Regular $ timing:');
try {
  const startTime1 = Date.now();
  const timedRunner1 = $`bash -c '${testCommand}'`;
  
  let message1Count = 0;
  
  timedRunner1.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      message1Count++;
      const elapsed = ((Date.now() - startTime1) / 1000).toFixed(3);
      console.log(`   ⏱️  [${elapsed}s] Regular: ${line}`);
    }
  });
  
  timedRunner1.on('close', () => {
    const totalTime1 = ((Date.now() - startTime1) / 1000).toFixed(3);
    console.log(`   🏁 Regular $ finished in ${totalTime1}s with ${message1Count} messages`);
  });
  
  await timedRunner1;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   Configured $ timing:');
const $timed = $({ mirror: false, capture: true });

try {
  const startTime2 = Date.now();
  const timedRunner2 = $timed`bash -c '${testCommand}'`;
  
  let message2Count = 0;
  
  timedRunner2.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      message2Count++;
      const elapsed = ((Date.now() - startTime2) / 1000).toFixed(3);
      console.log(`   ⏱️  [${elapsed}s] Configured: ${line}`);
    }
  });
  
  timedRunner2.on('close', () => {
    const totalTime2 = ((Date.now() - startTime2) / 1000).toFixed(3);
    console.log(`   🏁 Configured $ finished in ${totalTime2}s with ${message2Count} messages`);
  });
  
  const result = await timedRunner2;
  console.log(`   💾 Final captured result: ${result.stdout.split('\n').length - 1} lines`);
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 4: Multiple event listeners comparison
console.log('4. Multiple event listeners:');

console.log('   Regular $ with multiple listeners:');
try {
  const multiRunner1 = $`echo -e "Event 1\\nEvent 2\\nEvent 3"`;
  
  // First listener - counts events
  let eventCount1 = 0;
  multiRunner1.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    eventCount1 += lines.length;
  });
  
  // Second listener - processes events
  multiRunner1.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      console.log(`   📨 Regular listener: ${line}`);
    }
  });
  
  // Third listener - logs timing
  const start1 = Date.now();
  multiRunner1.on('close', () => {
    const duration = Date.now() - start1;
    console.log(`   ⏰ Regular $ processed ${eventCount1} events in ${duration}ms`);
  });
  
  await multiRunner1;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   Configured $ with multiple listeners:');
const $multiConfig = $({ mirror: false });

try {
  const multiRunner2 = $multiConfig`echo -e "Config Event 1\\nConfig Event 2\\nConfig Event 3"`;
  
  // First listener - counts events
  let eventCount2 = 0;
  multiRunner2.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    eventCount2 += lines.length;
  });
  
  // Second listener - processes events
  multiRunner2.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      console.log(`   📨 Configured listener: ${line}`);
    }
  });
  
  // Third listener - logs timing
  const start2 = Date.now();
  multiRunner2.on('close', () => {
    const duration = Date.now() - start2;
    console.log(`   ⏰ Configured $ processed ${eventCount2} events in ${duration}ms`);
  });
  
  await multiRunner2;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 5: Reusable event configurations
console.log('5. Reusable event configurations:');

// Create reusable configurations
const $logger = $({ mirror: false });
const $monitor = $({ mirror: false, capture: true });
const $silent = $({ mirror: false });

const commands = [
  'echo "Log entry 1"',
  'echo "Monitor data 2"', 
  'echo "Silent operation 3"'
];

console.log('   Using reusable configurations:');

try {
  // Logger configuration
  const logRunner = $logger`${commands[0]}`;
  logRunner.on('stdout', (data) => {
    console.log(`   📜 Logger: ${data.toString().trim()}`);
  });
  logRunner.on('close', () => {
    console.log(`   ✅ Logger completed`);
  });
  
  // Monitor configuration  
  const monitorRunner = $monitor`${commands[1]}`;
  monitorRunner.on('stdout', (data) => {
    console.log(`   📊 Monitor: ${data.toString().trim()}`);
  });
  monitorRunner.on('close', () => {
    console.log(`   ✅ Monitor completed`);
  });
  
  // Silent configuration
  const silentRunner = $silent`${commands[2]}`;
  silentRunner.on('stdout', (data) => {
    console.log(`   🔇 Silent: ${data.toString().trim()}`);
  });
  silentRunner.on('close', () => {
    console.log(`   ✅ Silent completed`);
  });
  
  // Wait for all to complete
  await Promise.all([logRunner, monitorRunner, silentRunner]);
  
  // Check monitor's captured result
  const monitorResult = await monitorRunner;
  console.log(`   💾 Monitor captured: "${monitorResult.stdout.trim()}"`);
  
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n=== Event handling syntax comparison completed ===');