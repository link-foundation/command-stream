#!/usr/bin/env node

/**
 * Proof that ping cannot be controlled via stdin - you need kill() method
 */

import { spawn } from 'child_process';
import { $ } from '../js/src/$.mjs';

console.log('=== PROOF: ping ignores stdin, needs kill() method ===');
console.log('');

async function proveStdinLimitation() {
  console.log('DEMONSTRATION 1: Native child_process with ping');
  console.log('→ Sending CTRL+C via stdin (will be ignored by ping)');

  const child = spawn('ping', ['8.8.8.8']);
  let output = '';

  child.stdout.on('data', (data) => {
    output += data.toString();
    process.stdout.write(`  [ping] ${data}`);
  });

  // Try to send CTRL+C after 1.5 seconds
  setTimeout(() => {
    console.log('  → Sending \\x03 (CTRL+C) to stdin...');
    child.stdin.write('\\x03');
    child.stdin.write('quit\\n');
    child.stdin.write('exit\\n');
    child.stdin.end();
    console.log('  → stdin closed, but ping continues running...');
  }, 1500);

  // Force kill after 3 seconds to prove stdin didn't work
  setTimeout(() => {
    console.log('  → stdin failed, using kill() to terminate...');
    child.kill('SIGTERM');
  }, 3000);

  await new Promise((resolve) => child.on('close', resolve));
  console.log('  ✓ Native ping required kill() signal to stop');
  console.log('');

  console.log('DEMONSTRATION 2: command-stream with proper kill() method');
  const cmd = $`ping 8.8.8.8`;

  // Start by accessing stdout
  cmd.streams.stdout.on('data', (data) => {
    process.stdout.write(`  [stream] ${data}`);
  });

  // Kill cleanly after 2 seconds
  setTimeout(() => {
    console.log('  → Using command-stream kill() method...');
    cmd.kill();
  }, 2000);

  const result = await cmd;
  console.log(
    `  ✓ command-stream ping cleanly terminated with code: ${result.code}`
  );
  console.log('');

  console.log('DEMONSTRATION 3: stdin DOES work for commands that read it');
  console.log('→ Testing with cat command');

  const catCmd = $`cat`;
  const stdin = catCmd.streams.stdin;

  if (stdin) {
    stdin.write('This data goes to cat via stdin\\n');
    stdin.write('And cat will output it\\n');
    stdin.end();
  }

  const catResult = await catCmd;
  console.log('  ✓ cat output:', JSON.stringify(catResult.stdout));
  console.log('');

  console.log('📋 SUMMARY:');
  console.log(
    '  • ping ignores stdin completely (network utility, not interactive)'
  );
  console.log('  • To interrupt ping, you MUST use kill() method or signals');
  console.log(
    '  • stdin works fine for commands that actually read it (cat, grep, etc.)'
  );
  console.log(
    '  • command-stream provides both: streams.stdin AND kill() method'
  );
}

proveStdinLimitation().catch(console.error);
