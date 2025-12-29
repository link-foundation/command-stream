#!/usr/bin/env node

/**
 * Basic Claude streaming example with command-stream
 *
 * This example demonstrates:
 * 1. Real-time streaming output from Claude
 * 2. Multiple chunks/events being captured
 * 3. Both console display and file writing simultaneously
 */

import { $ } from '../src/$.mjs';
import { writeFileSync, appendFileSync, existsSync } from 'fs';

// Claude command - using a prompt that should generate multiple chunks
const claudeCommand = 'claude';
const prompt =
  'Count from 1 to 5, explaining each number briefly. Use --output-format stream-json if available.';

console.log('🚀 Starting Claude streaming example...\n');

// Clean up any existing log file
const logFile = 'claude-streaming.log';
if (existsSync(logFile)) {
  writeFileSync(logFile, '');
}

console.log('📝 Command being executed:');
console.log(`${claudeCommand} "${prompt}"`);
console.log('\n🌊 Streaming output:\n');

let chunkCount = 0;
let totalOutput = '';

try {
  // Create the command but don't start it yet
  const command = $`${claudeCommand} "${prompt}"`;

  // Attach event handlers
  command
    .on('data', (chunk) => {
      chunkCount++;
      const data = chunk.data.toString();

      console.log(`📦 Chunk ${chunkCount} (${chunk.type}):`);
      console.log(data);
      console.log('---');

      // Write to log file in real-time
      appendFileSync(
        logFile,
        `=== Chunk ${chunkCount} (${chunk.type}) ===\n${data}\n`
      );

      totalOutput += data;
    })
    .on('stderr', (chunk) => {
      const data = chunk.toString();
      console.log('⚠️ stderr:', data);
      appendFileSync(logFile, `=== STDERR ===\n${data}\n`);
    })
    .on('end', (result) => {
      console.log('\n✅ Streaming completed!');
      console.log(`📊 Total chunks received: ${chunkCount}`);
      console.log(`📁 Log saved to: ${logFile}`);
      console.log(`🎯 Exit code: ${result.code}`);
      console.log(`📏 Total output length: ${totalOutput.length} characters`);

      // Write final summary
      appendFileSync(
        logFile,
        `\n=== SUMMARY ===\nTotal chunks: ${chunkCount}\nExit code: ${result.code}\nTotal length: ${totalOutput.length}\n`
      );
    })
    .on('error', (error) => {
      console.error('❌ Error:', error);
      appendFileSync(logFile, `=== ERROR ===\n${error}\n`);
    });

  // Start the command
  await command.start();
} catch (error) {
  console.error('💥 Failed to execute command:', error.message);

  // Check if claude command is available
  try {
    const checkResult = await $`which ${claudeCommand}`;
    if (checkResult.code !== 0) {
      console.log(
        '\n💡 Tip: Make sure Claude CLI is installed and in your PATH'
      );
      console.log(
        '   You can install it from: https://github.com/anthropics/claude-cli'
      );
    }
  } catch (checkError) {
    console.log('\n💡 Claude CLI not found in PATH. Please install it first.');
  }
}
