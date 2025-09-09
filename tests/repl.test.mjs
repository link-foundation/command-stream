#!/usr/bin/env node

import { describe, it, expect } from 'bun:test';
import './test-helper.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../bin/cli.mjs');

describe('REPL', () => {
  it('should start REPL and respond to help command', async () => {
    const repl = spawn('node', [cliPath, 'repl'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let output = '';
    let errorOutput = '';

    repl.stdout.on('data', (data) => {
      output += data.toString();
    });

    repl.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // Wait for REPL to start
    await new Promise((resolve) => {
      const checkStarted = () => {
        if (output.includes('command-stream REPL')) {
          resolve();
        } else {
          setTimeout(checkStarted, 100);
        }
      };
      checkStarted();
    });

    expect(output).toContain('command-stream REPL');
    expect(output).toContain('Interactive shell environment');

    // Send help command
    repl.stdin.write('help\n');

    // Wait for help output
    await new Promise((resolve) => {
      const checkHelp = () => {
        if (output.includes('Available commands:')) {
          resolve();
        } else {
          setTimeout(checkHelp, 100);
        }
      };
      setTimeout(checkHelp, 100);
    });

    expect(output).toContain('Available commands:');
    expect(output).toContain('help');
    expect(output).toContain('exit');

    // Send exit command
    repl.stdin.write('exit\n');

    await new Promise((resolve, reject) => {
      repl.on('close', (code) => {
        resolve(code);
      });
      repl.on('error', reject);
    });

    expect(output).toContain('Goodbye!');
  }, 10000);

  it('should execute $ commands in REPL', async () => {
    const repl = spawn('node', [cliPath, 'repl'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let output = '';
    let errorOutput = '';

    repl.stdout.on('data', (data) => {
      output += data.toString();
    });

    repl.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // Wait for REPL to start
    await new Promise((resolve) => {
      const checkStarted = () => {
        if (output.includes('command-stream REPL')) {
          resolve();
        } else {
          setTimeout(checkStarted, 100);
        }
      };
      checkStarted();
    });

    // Send a simple $ command
    repl.stdin.write('await $`echo "hello from repl"`\n');

    // Wait for command execution
    await new Promise((resolve) => {
      const checkExecution = () => {
        if (output.includes('hello from repl')) {
          resolve();
        } else {
          setTimeout(checkExecution, 100);
        }
      };
      setTimeout(checkExecution, 500);
    });

    expect(output).toContain('hello from repl');

    // Exit
    repl.stdin.write('exit\n');
    await new Promise((resolve) => repl.on('close', resolve));
  }, 15000);

  it('should handle .commands REPL command', async () => {
    const repl = spawn('node', [cliPath, 'repl'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let output = '';

    repl.stdout.on('data', (data) => {
      output += data.toString();
    });

    // Wait for REPL to start
    await new Promise((resolve) => {
      const checkStarted = () => {
        if (output.includes('command-stream REPL')) {
          resolve();
        } else {
          setTimeout(checkStarted, 100);
        }
      };
      checkStarted();
    });

    // Send .commands
    repl.stdin.write('.commands\n');

    // Wait for commands output
    await new Promise((resolve) => {
      const checkCommands = () => {
        if (output.includes('Registered virtual commands:')) {
          resolve();
        } else {
          setTimeout(checkCommands, 100);
        }
      };
      setTimeout(checkCommands, 500);
    });

    expect(output).toContain('Registered virtual commands:');
    expect(output).toContain('cd'); // Should show built-in commands

    // Exit
    repl.stdin.write('exit\n');
    await new Promise((resolve) => repl.on('close', resolve));
  }, 10000);
});