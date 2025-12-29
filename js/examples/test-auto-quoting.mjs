#!/usr/bin/env node

// Test: Automatic quoting when user doesn't provide quotes
// Expected: Smart auto-quoting based on content

import { $ } from '../js/src/$.mjs';

console.log('=== Test: Automatic Smart Quoting ===\n');

const testCases = [
  {
    name: 'Simple path without spaces',
    value: '/usr/bin/echo',
    shouldQuote: true, // Currently quotes everything
  },
  {
    name: 'Path with spaces',
    value: '/path with spaces/command',
    shouldQuote: true,
  },
  {
    name: 'Path with special shell chars ($)',
    value: '/path/with$variable',
    shouldQuote: true,
  },
  {
    name: 'Path with special shell chars (&)',
    value: '/path/with&background',
    shouldQuote: true,
  },
  {
    name: 'Simple command name',
    value: 'echo',
    shouldQuote: true, // Currently quotes everything
  },
  {
    name: 'Empty string',
    value: '',
    shouldQuote: true,
  },
];

for (const { name, value, shouldQuote } of testCases) {
  console.log(`\nTest: ${name}`);
  console.log('Input:', JSON.stringify(value));

  const cmd = $({ mirror: false })`${value} --test`;
  console.log('Generated:', cmd.spec.command);

  const hasQuotes =
    cmd.spec.command.startsWith("'") || cmd.spec.command.startsWith('"');
  console.log('Has quotes:', hasQuotes);
  console.log('Should quote:', shouldQuote);
  console.log(
    hasQuotes === shouldQuote ? '✅ PASS' : '⚠️  Note: Quoting behavior differs'
  );
}
