#!/usr/bin/env node

// More targeted test to find the real Bun shell path issue
import { $ } from '../src/$.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';
console.log(`=== Bun Runtime Shell Path Test ===`);
console.log(`Runtime: ${isBun ? 'Bun' : 'Node.js'}`);
console.log(`Platform: ${process.platform}`);

// Enable verbose mode to see shell detection
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('\n=== Simple Commands ===');

// Test simple commands
const simpleCommands = [
    'pwd',
    'echo hello',
    'ls /bin/sh',
    'test -f /bin/sh && echo "sh exists"'
];

for (const cmd of simpleCommands) {
    console.log(`\nTesting: ${cmd}`);
    try {
        const result = await $`${cmd}`;
        console.log(`✓ Success: ${result.stdout.toString().trim()}`);
    } catch (error) {
        console.log(`✗ Failed: ${error.message}`);
        console.log(`  Code: ${error.code}`);
        if (error.stderr) {
            console.log(`  Stderr: ${error.stderr.toString().trim()}`);
        }
    }
}

console.log('\n=== Testing Shell Detection Explicitly ===');

// Import the findAvailableShell function for direct testing
import fs from 'fs';
import cp from 'child_process';

// Test the actual shell detection logic that might be failing in Bun
console.log('\nTesting shell existence:');
const shellPaths = ['/bin/sh', '/usr/bin/sh', '/bin/bash', '/usr/bin/bash'];
for (const shellPath of shellPaths) {
    try {
        const exists = fs.existsSync(shellPath);
        console.log(`${shellPath}: ${exists ? '✓' : '✗'}`);
    } catch (error) {
        console.log(`${shellPath}: error - ${error.message}`);
    }
}

console.log('\nTesting which command:');
const shells = ['sh', 'bash', 'which'];
for (const shell of shells) {
    try {
        const result = cp.spawnSync('which', [shell], { encoding: 'utf-8' });
        console.log(`which ${shell}: status=${result.status}, stdout="${result.stdout?.trim()}", stderr="${result.stderr?.trim()}"`);
    } catch (error) {
        console.log(`which ${shell}: error - ${error.message}`);
    }
}

console.log('\n=== Testing Direct Bun Spawn ===');
if (isBun) {
    // Test Bun.spawn directly to see if that's the issue
    console.log('Testing Bun.spawn with /bin/sh:');
    try {
        const proc = Bun.spawn(['/bin/sh', '-c', 'echo "Bun spawn test"'], {
            stdout: 'pipe',
            stderr: 'pipe'
        });
        
        const text = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        
        console.log(`✓ Bun.spawn success: exitCode=${exitCode}, output="${text.trim()}"`);
    } catch (error) {
        console.log(`✗ Bun.spawn failed: ${error.message}`);
    }
    
    console.log('Testing Bun.spawn with which sh:');
    try {
        const proc = Bun.spawn(['which', 'sh'], {
            stdout: 'pipe',
            stderr: 'pipe'
        });
        
        const text = await new Response(proc.stdout).text();
        const errorText = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        
        console.log(`Bun.spawn which: exitCode=${exitCode}, stdout="${text.trim()}", stderr="${errorText.trim()}"`);
    } catch (error) {
        console.log(`✗ Bun.spawn which failed: ${error.message}`);
    }
}