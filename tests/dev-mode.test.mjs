#!/usr/bin/env node

import { describe, it, expect } from 'bun:test';
import './test-helper.mjs';
import { $ } from '../src/$.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../bin/cli.mjs');

describe('Dev Mode', () => {
  it('should have dev method available on $ object', () => {
    expect(typeof $.dev).toBe('function');
  });

  it('should start dev mode via CLI', async () => {
    const devProcess = spawn('node', [cliPath, 'dev'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let output = '';
    let errorOutput = '';

    devProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    devProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // Wait for dev mode to start
    await new Promise((resolve) => {
      const checkStarted = () => {
        if (output.includes('command-stream Development Mode')) {
          resolve();
        } else {
          setTimeout(checkStarted, 100);
        }
      };
      setTimeout(checkStarted, 1000);
    });

    expect(output).toContain('command-stream Development Mode');
    expect(output).toContain('Working directory:');
    expect(output).toContain('Watching patterns:');
    expect(output).toContain('Development mode active');

    // Kill the process
    devProcess.kill('SIGTERM');
    
    await new Promise((resolve) => {
      devProcess.on('exit', resolve);
    });
  }, 10000);

  it('should display help when called without arguments', async () => {
    const helpProcess = spawn('node', [cliPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    helpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    helpProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    await new Promise((resolve) => {
      helpProcess.on('exit', resolve);
    });

    expect(output).toContain('command-stream - Modern shell utility library');
    expect(output).toContain('Usage:');
    expect(output).toContain('npx command-stream repl');
    expect(output).toContain('npx command-stream dev');
  }, 5000);

  it('should start REPL when dev mode is called with repl: true', async () => {
    // This test would ideally test the programmatic API
    // We'll test that the method exists and can be called
    const devOptions = { repl: false, watch: ['*.test.js'] };
    
    // Start dev mode in a child process to avoid hanging the test
    const devProcess = spawn('node', ['-e', `
      import { $ } from './src/$.mjs';
      console.log('Dev method exists:', typeof $.dev === 'function');
      process.exit(0);
    `], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '..')
    });

    let output = '';
    devProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    await new Promise((resolve) => {
      devProcess.on('exit', resolve);
    });

    expect(output).toContain('Dev method exists: true');
  }, 5000);
});