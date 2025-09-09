#!/usr/bin/env node

// Debug command parsing
import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('=== Command Parsing Debug ===');
console.log(`Runtime: ${typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js'}`);

// Test different command formats
const testCommands = [
    'echo hello',
    'echo "hello world"',
    'ls -la',
    'pwd',
    'cat /etc/passwd | head -5'  // This should trigger needsShell=true
];

for (const cmdStr of testCommands) {
    console.log(`\n--- Testing: ${cmdStr} ---`);
    
    // Let's manually check what parseShellCommand returns
    const { parseShellCommand, needsRealShell } = await import('../src/shell-parser.mjs');
    
    const parsed = parseShellCommand(cmdStr);
    const needsRealShellResult = needsRealShell(cmdStr);
    
    console.log(`Parsed result:`, JSON.stringify(parsed, null, 2));
    console.log(`needsRealShell:`, needsRealShellResult);
    
    // Check needsShell logic from the main code
    const needsShell = cmdStr.includes('*') || cmdStr.includes('$') ||
        cmdStr.includes('>') || cmdStr.includes('<') ||
        cmdStr.includes('&&') || cmdStr.includes('||') ||
        cmdStr.includes(';') || cmdStr.includes('`');
    
    console.log(`needsShell (from main logic):`, needsShell);
    
    try {
        const result = await $`${cmdStr}`;
        console.log(`✓ Success: ${result.stdout.toString().trim()}`);
    } catch (error) {
        console.log(`✗ Failed: ${error.message}`);
        if (error.code) {
            console.log(`  Code: ${error.code}`);
        }
        if (error.stderr) {
            console.log(`  Stderr: ${error.stderr.toString().trim()}`);
        }
    }
}