#!/usr/bin/env node

// Example: How to get PID of started commands
// This demonstrates different ways to access the process ID of running commands

import { $ } from '../src/$.mjs';

console.log('🆔 Process ID (PID) Access Examples\n');

// Example 1: Basic PID access with auto-start via streams
console.log('1️⃣  Basic PID Access (streams auto-start):');
const echoCmd = $`echo "Hello World"`;

// Accessing streams automatically starts the process
const stdout = await echoCmd.streams.stdout;

// Now the PID should be available
if (echoCmd.child && echoCmd.child.pid) {
  console.log(`   ✅ Command PID: ${echoCmd.child.pid}`);
  console.log(`   Command: echo "Hello World"`);
} else {
  console.log('   ⚠️  PID not available');
}

// Wait for completion and show output
const result1 = await echoCmd;
console.log(`   Output: ${result1.stdout.trim()}`);
console.log(`   Exit code: ${result1.code}\n`);

// Example 2: PID access with explicit start
console.log('2️⃣  PID Access with Explicit Start:');
const sleepCmd = $`sleep 2`;

// Start the command explicitly
await sleepCmd.start();

// Give it a moment to fully initialize
await new Promise(resolve => setTimeout(resolve, 10));

if (sleepCmd.child && sleepCmd.child.pid) {
  console.log(`   ✅ Sleep command PID: ${sleepCmd.child.pid}`);
  console.log(`   Command: sleep 2`);
  console.log(`   Status: running...`);
} else {
  console.log('   ⚠️  PID not available');
}

// Wait for completion
const result2 = await sleepCmd;
console.log(`   Sleep completed with exit code: ${result2.code}\n`);

// Example 3: Multiple commands with PID tracking using streams
console.log('3️⃣  Multiple Commands PID Tracking:');
const commands = [
  $`sleep 0.5`,  // Use sleep to keep process alive longer
  $`sleep 0.5`, 
  $`sleep 0.5`
];

const pids = [];

// Start all commands and collect PIDs using streams access
for (let i = 0; i < commands.length; i++) {
  const cmd = commands[i];
  // Access streams to auto-start the process
  const stdout = await cmd.streams.stdout;
  
  if (cmd.child && cmd.child.pid) {
    pids.push(cmd.child.pid);
    console.log(`   ✅ Command ${i + 1} PID: ${cmd.child.pid}`);
  } else {
    console.log(`   ⚠️  Command ${i + 1} PID: not available`);
  }
}

// Wait for all to complete
const results = await Promise.all(commands);
console.log(`   All ${results.length} commands completed\n`);

// Example 4: PID access with streaming  
console.log('4️⃣  Streaming with PID Access:');
const pingCmd = $`ping -c 3 127.0.0.1`;

// Start streaming - this auto-starts the process
const stream = pingCmd.stream();

// Small delay to let the process fully initialize
await new Promise(resolve => setTimeout(resolve, 100));

if (pingCmd.child && pingCmd.child.pid) {
  console.log(`   ✅ Ping command PID: ${pingCmd.child.pid}`);
  console.log(`   Streaming ping output:`);
  
  // Process streaming output
  for await (const chunk of stream) {
    if (chunk.type === 'stdout') {
      const line = chunk.data.toString().trim();
      if (line && line.includes('ping') || line.includes('bytes') || line.includes('time=')) {
        console.log(`   📡 ${line}`);
      }
    }
  }
} else {
  console.log('   ⚠️  Could not access PID for streaming command');
}

console.log('\n');

// Example 5: PID with event-based processing
console.log('5️⃣  Event-based Processing with PID:');
const eventCmd = $`sleep 1`  // Use sleep for a longer-running process
  .on('stdout', (chunk) => {
    console.log(`   📋 Event: Received output: ${chunk.toString().trim()}`);
  })
  .on('end', (result) => {
    console.log(`   📋 Event: Command finished with exit code ${result.code}`);
  });

// Access streams to start the process, then check PID
const eventStdout = await eventCmd.streams.stdout;
if (eventCmd.child && eventCmd.child.pid) {
  console.log(`   📋 ✅ Event-based command PID: ${eventCmd.child.pid}`);
}

// Wait for completion
await eventCmd;

console.log('\n');

// Example 6: PID availability timeline with proper initialization
console.log('6️⃣  PID Availability Timeline:');
const timelineCmd = $`sleep 0.5`;

console.log('   🕐 Before accessing streams: PID available?', !!(timelineCmd.child && timelineCmd.child.pid));

// Access streams to start the process
const timelineStdout = await timelineCmd.streams.stdout;
console.log('   🕐 After accessing streams: PID available?', !!(timelineCmd.child && timelineCmd.child.pid));

if (timelineCmd.child && timelineCmd.child.pid) {
  console.log(`   🕐 ✅ PID during execution: ${timelineCmd.child.pid}`);
}

await timelineCmd;
console.log('   🕐 After completion: PID available?', !!(timelineCmd.child && timelineCmd.child.pid));

console.log('\n');

// Example 7: Error handling and best practices
console.log('7️⃣  Best Practices for PID Access:');

function getPidSafely(command, commandName) {
  try {
    if (command.child && command.child.pid) {
      return command.child.pid;
    } else {
      console.log(`   ⚠️  PID not available for ${commandName}`);
      console.log(`   💡 Tip: Access .streams or call .start() first`);
      return null;
    }
  } catch (error) {
    console.log(`   ❌ Error accessing PID for ${commandName}:`, error.message);
    return null;
  }
}

const safeCmd = $`sleep 0.2`;

// Method 1: Access streams to initialize
const safeStdout = await safeCmd.streams.stdout;
const pid = getPidSafely(safeCmd, 'sleep command');
if (pid) {
  console.log(`   ✅ Successfully got PID: ${pid}`);
}

await safeCmd;

console.log('\n🏁 All PID examples completed!');
console.log('\n📚 Key Takeaways:');
console.log('   • Access PID via: command.child.pid');
console.log('   • Process must be started first - use command.streams.* or command.start()');
console.log('   • PID becomes available once child process is created');
console.log('   • Always check if command.child and command.child.pid exist');
console.log('   • PID remains available even after command completion');
console.log('   • Use getPidSafely() pattern for robust error handling');
console.log('\n🔧 Three ways to start a process and access PID:');
console.log('   1. await command.streams.stdout  (recommended)');
console.log('   2. await command.start()');
console.log('   3. command.stream()  (for streaming)');
console.log('\n💡 Pro tip: For very fast commands, consider using sleep or long-running');
console.log('   commands to ensure PID remains accessible long enough.');