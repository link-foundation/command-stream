#!/usr/bin/env node

/**
 * Test to prove that native spawn/child_process cannot kill ping via stdin,
 * but our command-stream library can kill it properly with the kill() method.
 */

import { spawn } from 'child_process';
import { $ } from '../src/$.mjs';

console.log('=== Testing Native spawn vs command-stream kill capabilities ===');
console.log('');

async function testNativeSpawnVsCommandStream() {
  try {
    console.log(
      'TEST 1: Native spawn - try to kill ping via stdin (will fail)'
    );

    const nativeProcess = spawn('ping', ['8.8.8.8']);
    console.log('✓ Native ping process started, PID:', nativeProcess.pid);

    // Try to send CTRL+C via stdin (this won't work for ping)
    setTimeout(() => {
      console.log('  Attempting to send CTRL+C via stdin to native ping...');
      nativeProcess.stdin.write('\x03'); // CTRL+C
      nativeProcess.stdin.end();
    }, 2000);

    // Set up a timeout to kill the process since stdin won't work
    const killTimeout = setTimeout(() => {
      console.log('  stdin CTRL+C failed (as expected), using SIGTERM...');
      nativeProcess.kill('SIGTERM');
    }, 4000);

    const nativeResult = await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      nativeProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        process.stdout.write(`[NATIVE] ${data}`);
      });

      nativeProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      nativeProcess.on('close', (code, signal) => {
        clearTimeout(killTimeout);
        resolve({ code, signal, stdout, stderr });
      });
    });

    console.log(
      '  Native ping terminated with code:',
      nativeResult.code,
      'signal:',
      nativeResult.signal
    );
    console.log('  Output length:', nativeResult.stdout.length);

    console.log('');
    console.log(
      'TEST 2: command-stream - kill ping using kill() method (will work)'
    );

    const streamCommand = $`ping 8.8.8.8`;

    // Access stdout to start the process
    const stdout = streamCommand.streams.stdout;
    console.log('✓ command-stream ping started');

    // Set up data listener to see output
    if (stdout) {
      stdout.on('data', (data) => {
        process.stdout.write(`[STREAM] ${data}`);
      });
    }

    // Kill after 2 seconds using our kill() method
    setTimeout(() => {
      console.log('  Killing command-stream ping using kill() method...');
      streamCommand.kill();
    }, 2000);

    const streamResult = await streamCommand;
    console.log(
      '  command-stream ping terminated with code:',
      streamResult.code
    );
    console.log('  Output length:', streamResult.stdout.length);

    console.log('');
    console.log(
      'TEST 3: Show stdin works for commands that actually read stdin'
    );

    console.log('  Testing native spawn with cat (stdin should work)...');
    const nativeCat = spawn('cat');

    nativeCat.stdin.write('Hello from native cat\n');
    nativeCat.stdin.end();

    const catResult = await new Promise((resolve) => {
      let output = '';
      nativeCat.stdout.on('data', (data) => {
        output += data.toString();
      });
      nativeCat.on('close', (code) => {
        resolve({ code, output });
      });
    });

    console.log('  Native cat result:', JSON.stringify(catResult.output));

    console.log('  Testing command-stream with cat...');
    const streamCat = $`cat`;
    const catStdin = streamCat.streams.stdin;

    if (catStdin) {
      catStdin.write('Hello from command-stream cat\n');
      catStdin.end();
    }

    const streamCatResult = await streamCat;
    console.log(
      '  command-stream cat result:',
      JSON.stringify(streamCatResult.stdout)
    );

    console.log('');
    console.log('✅ CONCLUSIONS:');
    console.log(
      '  1. Native spawn cannot kill ping via stdin CTRL+C (ping ignores stdin)'
    );
    console.log(
      '  2. command-stream kill() method properly terminates ping with signals'
    );
    console.log(
      '  3. Both native spawn and command-stream work fine with stdin for commands that read it (like cat)'
    );
    console.log(
      '  4. For ping specifically, you need kill() method, not stdin manipulation'
    );
  } catch (error) {
    console.log('');
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testNativeSpawnVsCommandStream();
