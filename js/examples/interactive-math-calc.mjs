#!/usr/bin/env node

// Interactive math calculator for testing streaming I/O
// Reads expressions from stdin, evaluates them, and writes results to stdout
// Send "exit" or "\q" to quit

import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false, // Don't treat as TTY
});

console.log('READY'); // Signal that calculator is ready

rl.on('line', (line) => {
  const input = line.trim();

  // Check for exit commands
  if (input === 'exit' || input === '\\q' || input === 'quit') {
    console.log('GOODBYE');
    process.exit(0);
  }

  // Try to evaluate the math expression
  try {
    // Parse simple math expressions like "1+2", "3*4", "10/2", "5-3"
    const result = eval(input); // Using eval for simplicity in test
    console.log(`RESULT: ${result}`);
  } catch (error) {
    console.error(`ERROR: Invalid expression: ${input}`);
  }
});

// Handle stdin close
rl.on('close', () => {
  process.exit(0);
});

// Ensure output is not buffered
process.stdout.setDefaultEncoding('utf8');
if (process.stdout._handle && process.stdout._handle.setBlocking) {
  process.stdout._handle.setBlocking(true);
}
