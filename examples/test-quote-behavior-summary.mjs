#!/usr/bin/env node

// Comprehensive test of the smart quoting behavior
import { $ } from '../src/$.mjs';

console.log('=== Smart Quoting Behavior Summary ===\n');

const tests = [
  { category: 'SAFE STRINGS (No quotes needed)', tests: [
    { input: 'hello', expected: 'hello' },
    { input: '/usr/bin/echo', expected: '/usr/bin/echo' },
    { input: 'file.txt', expected: 'file.txt' },
    { input: 'user@host.com', expected: 'user@host.com' },
    { input: 'key=value', expected: 'key=value' },
    { input: '192.168.1.1', expected: '192.168.1.1' },
    { input: 'v1.2.3-beta', expected: 'v1.2.3-beta' },
  ]},
  
  { category: 'UNSAFE STRINGS (Auto-quoted)', tests: [
    { input: 'hello world', expected: "'hello world'" },
    { input: '$HOME', expected: "'$HOME'" },
    { input: '$(whoami)', expected: "'$(whoami)'" },
    { input: '`date`', expected: "'`date`'" },
    { input: 'test; ls', expected: "'test; ls'" },
    { input: 'a|b', expected: "'a|b'" },
    { input: 'a&b', expected: "'a&b'" },
    { input: 'a>b', expected: "'a>b'" },
    { input: '*.txt', expected: "'*.txt'" },
    { input: 'a b c', expected: "'a b c'" },
  ]},
  
  { category: 'USER-PROVIDED SINGLE QUOTES (Preserved)', tests: [
    { input: "'hello'", expected: "'hello'" },
    { input: "'hello world'", expected: "'hello world'" },
    { input: "'$HOME'", expected: "'$HOME'" },
    { input: "'/path with spaces/cmd'", expected: "'/path with spaces/cmd'" },
    { input: "'test; echo BAD'", expected: "'test; echo BAD'" },
  ]},
  
  { category: 'USER-PROVIDED DOUBLE QUOTES (Wrapped)', tests: [
    { input: '"hello"', expected: '\'"hello"\'' },
    { input: '"hello world"', expected: '\'"hello world"\'' },
    { input: '"$HOME"', expected: '\'"$HOME"\'' },
    { input: '"/path with spaces/cmd"', expected: '\'"/path with spaces/cmd"\'' },
    { input: '"test; echo BAD"', expected: '\'"test; echo BAD"\'' },
  ]},
  
  { category: 'COMPLEX CASES', tests: [
    { input: "it's", expected: "'it'\\''s'" },
    { input: "'it's'", expected: "''\\''it'\\''s'\\'''" },  // Invalid quoted string, needs re-escaping
    { input: '""', expected: "'\"\"'" },
    { input: "''", expected: "''" },
    { input: "'", expected: "''\\'''" },
    { input: '"', expected: "'\"'" },
  ]},
];

let totalPassed = 0;
let totalFailed = 0;

tests.forEach(({ category, tests: categoryTests }) => {
  console.log(`\n${category}`);
  console.log('='.repeat(category.length));
  
  categoryTests.forEach(({ input, expected }) => {
    const cmd = $({ mirror: false })`echo ${input}`;
    const actual = cmd.spec.command.replace('echo ', '');
    const passed = actual === expected;
    
    if (passed) {
      console.log(`✅ ${input.padEnd(25)} → ${actual}`);
      totalPassed++;
    } else {
      console.log(`❌ ${input.padEnd(25)} → ${actual} (expected: ${expected})`);
      totalFailed++;
    }
  });
});

console.log('\n' + '='.repeat(50));
console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);

if (totalFailed === 0) {
  console.log('\n🎉 All quoting behaviors work as expected!');
  console.log('\nKey features:');
  console.log('✓ No unnecessary quoting for safe strings');
  console.log('✓ Automatic quoting for strings with special characters');
  console.log('✓ User-provided single quotes are preserved');
  console.log('✓ User-provided double quotes are preserved (wrapped)');
  console.log('✓ No double-quoting when user already quoted');
  console.log('✓ Shell injection protection maintained');
}