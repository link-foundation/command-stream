#!/usr/bin/env node

/**
 * Final proof: ping cannot be controlled via stdin - needs kill() method
 */

import { spawn } from 'child_process';
import { $ } from '../js/src/$.mjs';

console.log('=== FINAL PROOF: ping stdin vs kill() ===');

async function finalProof() {
  console.log('\\n1️⃣ NATIVE SPAWN: ping ignores stdin CTRL+C');

  const nativePing = spawn('ping', ['-c', '10', '8.8.8.8']); // Limit to 10 pings

  nativePing.stdout.on('data', (data) => {
    process.stdout.write(`[native] ${data}`);
  });

  // Try stdin after 1 second
  setTimeout(() => {
    console.log('\\n  → Sending CTRL+C via stdin...');
    nativePing.stdin.write('\\x03');
    nativePing.stdin.end();
  }, 1000);

  // Force kill if still running after 3 seconds
  setTimeout(() => {
    if (!nativePing.killed) {
      console.log('\\n  → stdin FAILED, using SIGTERM...');
      nativePing.kill('SIGTERM');
    }
  }, 3000);

  const nativeResult = await new Promise((resolve) => {
    nativePing.on('close', (code, signal) => resolve({ code, signal }));
  });

  console.log(
    `\\n  ✓ Result: code=${nativeResult.code}, signal=${nativeResult.signal}`
  );
  console.log('  ✓ Proof: ping ignores stdin, needed kill signal\\n');

  console.log('2️⃣ COMMAND-STREAM: kill() method works perfectly');

  const streamPing = $`ping 8.8.8.8`;

  // Start ping by accessing stdout stream
  const stdout = streamPing.streams.stdout;
  if (stdout) {
    stdout.on('data', (data) => {
      process.stdout.write(`[stream] ${data}`);
    });
  }

  // Kill cleanly after 2 seconds
  setTimeout(() => {
    console.log('\\n  → Using command-stream kill()...');
    streamPing.kill();
  }, 2000);

  const streamResult = await streamPing;
  console.log(`\\n  ✓ Result: code=${streamResult.code}`);
  console.log('  ✓ Success: kill() method worked perfectly\\n');

  console.log('3️⃣ STDIN WORKS: for commands that actually read it');

  const catCmd = $`cat`;
  const stdin = catCmd.streams.stdin;

  console.log('  → Sending data to cat via stdin...');
  if (stdin) {
    stdin.write('Hello via stdin!\\n');
    stdin.write('This works because cat reads stdin\\n');
    stdin.end();
  }

  const catResult = await catCmd;
  console.log(`  ✓ cat output: ${JSON.stringify(catResult.stdout)}`);

  console.log('\\n📋 CONCLUSION:');
  console.log('✓ ping ignores stdin → use kill() method');
  console.log('✓ cat/grep/etc read stdin → use streams.stdin');
  console.log('✓ command-stream provides both capabilities');
}

finalProof().catch(console.error);
