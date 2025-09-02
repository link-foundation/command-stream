#!/usr/bin/env node

/**
 * Claude streaming demo with command-stream
 * 
 * This demonstrates:
 * 1. Real-time streaming output
 * 2. Multiple chunks/events being captured
 * 3. Simultaneous console display and file writing
 * 4. Handling of both stdout and stderr
 */

import { $ } from '../src/$.mjs';
import { writeFileSync, appendFileSync, existsSync } from 'fs';

// We'll use a command that produces output over time to simulate streaming
// If claude is not available, we'll fall back to a simulation
const claudeCommand = 'claude';
const fallbackCommand = 'sh -c \'for i in $(seq 1 5); do echo "Response chunk $i: This is simulated streaming output from Claude."; sleep 0.5; done\'';

console.log('🚀 Starting Claude streaming demo...\n');

// Clean up any existing log file
const logFile = 'claude-streaming-demo.log';
if (existsSync(logFile)) {
  writeFileSync(logFile, '');
}

let chunkCount = 0;
let totalOutput = '';

async function runClaudeDemo() {
  console.log('📝 Attempting to run Claude command...\n');
  
  try {
    // First check if claude is available
    const claudeCheck = await $`which ${claudeCommand}`;
    
    if (claudeCheck.code !== 0) {
      console.log('⚠️ Claude CLI not found, using fallback simulation\n');
      return runFallbackDemo();
    }
    
    // Try to run Claude with streaming output
    const prompt = "Count from 1 to 5, explaining each number briefly. Make each response a separate chunk if possible.";
    console.log(`🎯 Command: ${claudeCommand} "${prompt}"`);
    console.log('\n🌊 Streaming output:\n');
    
    const command = $`${claudeCommand} "${prompt}"`;
    
    command
      .on('data', handleChunk)
      .on('stderr', handleStderr)
      .on('end', handleEnd)
      .on('error', handleError);
    
    await command.start();
    
  } catch (error) {
    console.log('⚠️ Claude command failed, using fallback simulation\n');
    return runFallbackDemo();
  }
}

async function runFallbackDemo() {
  console.log('🎯 Running fallback streaming simulation');
  console.log('🌊 Streaming output:\n');
  
  const command = $`${fallbackCommand}`;
  
  command
    .on('data', handleChunk)
    .on('stderr', handleStderr)
    .on('end', handleEnd)
    .on('error', handleError);
  
  await command.start();
}

function handleChunk(chunk) {
  chunkCount++;
  const data = chunk.data.toString();
  
  console.log(`📦 Chunk ${chunkCount} (${chunk.type}):`);
  console.log(data);
  console.log('---');
  
  // Write to log file in real-time
  appendFileSync(logFile, `=== Chunk ${chunkCount} (${chunk.type}) ===\n${data}\n`);
  
  totalOutput += data;
}

function handleStderr(chunk) {
  const data = chunk.toString();
  console.log('⚠️ stderr:', data);
  appendFileSync(logFile, `=== STDERR ===\n${data}\n`);
}

function handleEnd(result) {
  console.log('\n✅ Streaming completed!');
  console.log(`📊 Total chunks received: ${chunkCount}`);
  console.log(`📁 Log saved to: ${logFile}`);
  console.log(`🎯 Exit code: ${result.code}`);
  console.log(`📏 Total output length: ${totalOutput.length} characters`);
  
  // Write final summary
  appendFileSync(logFile, `\n=== SUMMARY ===\nTotal chunks: ${chunkCount}\nExit code: ${result.code}\nTotal length: ${totalOutput.length}\n`);
  
  console.log('\n💡 Pro tip: Check the log file to see all captured output!');
}

function handleError(error) {
  console.error('❌ Error:', error);
  appendFileSync(logFile, `=== ERROR ===\n${error}\n`);
}

// Run the demo
runClaudeDemo().catch(console.error);