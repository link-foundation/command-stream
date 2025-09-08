#!/usr/bin/env node

// Test script to reproduce Bun shell path detection issues
import { $ } from '../src/$.mjs';

console.log('=== Shell Detection Test ===');
console.log(`Runtime: ${typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js'}`);
console.log(`Platform: ${process.platform}`);

const testCommands = [
    { cmd: 'echo "Hello, World!"', desc: 'Simple echo' },
    { cmd: 'pwd', desc: 'Print working directory' },
    { cmd: 'date', desc: 'Current date' },
    { cmd: 'which sh', desc: 'Find sh location' },
    { cmd: 'which bash', desc: 'Find bash location' }
];

console.log('\n=== Testing Commands ===');
for (const { cmd, desc } of testCommands) {
    console.log(`\nTest: ${desc}`);
    console.log(`Command: ${cmd}`);
    try {
        const result = await $`${cmd}`;
        console.log('✓ Success:', result.stdout.toString().trim());
    } catch (error) {
        console.log('✗ Failed:', error.message);
        if (error.code === 'ENOENT') {
            console.log('  Error: ENOENT - Command/Shell not found');
            console.log('  This indicates shell path resolution issues!');
        }
        if (error.stderr) {
            console.log('  Stderr:', error.stderr.toString().trim());
        }
    }
}

console.log('\n=== Testing Shell Detection Directly ===');
// Test shell detection by importing the function directly
import fs from 'fs';
import cp from 'child_process';

const isBun = typeof globalThis.Bun !== 'undefined';

console.log('\nTesting individual shell paths:');
const shellsToTest = ['/bin/sh', '/usr/bin/sh', '/bin/bash', '/usr/bin/bash'];

for (const shellPath of shellsToTest) {
    const exists = fs.existsSync(shellPath);
    console.log(`${shellPath}: ${exists ? '✓ exists' : '✗ not found'}`);
}

console.log('\nTesting `which` command in both runtimes:');
const shellNames = ['sh', 'bash', 'zsh'];

for (const shellName of shellNames) {
    try {
        const result = cp.spawnSync('which', [shellName], { encoding: 'utf-8' });
        if (result.status === 0 && result.stdout) {
            console.log(`which ${shellName}: ✓ ${result.stdout.trim()}`);
        } else {
            console.log(`which ${shellName}: ✗ not found (status: ${result.status})`);
            if (result.stderr) {
                console.log(`  stderr: ${result.stderr.trim()}`);
            }
        }
    } catch (error) {
        console.log(`which ${shellName}: ✗ error - ${error.message}`);
    }
}