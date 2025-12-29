#!/usr/bin/env node

/**
 * Debug script to understand jq TTY and color behavior
 * This helps diagnose why the test behaves differently in different environments
 */

import { $ } from '../js/src/$.mjs';
import { spawn } from 'child_process';

const testJson =
  '{"message": "hello", "number": 42, "active": true, "data": null}';

console.log('='.repeat(60));
console.log('JQ TTY AND COLOR BEHAVIOR DIAGNOSTIC');
console.log('='.repeat(60));

// 1. Check current environment
console.log('\n1. ENVIRONMENT INFORMATION:');
console.log('-'.repeat(40));
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('TTY Status:');
console.log('  - process.stdout.isTTY:', process.stdout.isTTY);
console.log('  - process.stderr.isTTY:', process.stderr.isTTY);
console.log('  - process.stdin.isTTY:', process.stdin.isTTY);
console.log('Environment variables:');
console.log('  - TERM:', process.env.TERM || '(not set)');
console.log('  - COLORTERM:', process.env.COLORTERM || '(not set)');
console.log('  - NO_COLOR:', process.env.NO_COLOR || '(not set)');
console.log('  - FORCE_COLOR:', process.env.FORCE_COLOR || '(not set)');
console.log('  - CI:', process.env.CI || '(not set)');

// 2. Test jq version and capabilities
console.log('\n2. JQ VERSION AND CAPABILITIES:');
console.log('-'.repeat(40));
try {
  const jqVersion = await $`jq --version`;
  console.log('jq version:', jqVersion.stdout.trim());
} catch (e) {
  console.log('Error getting jq version:', e.message);
}

// 3. Test default jq behavior through command-stream
console.log('\n3. JQ THROUGH COMMAND-STREAM (default):');
console.log('-'.repeat(40));
const defaultResult = await $`echo ${testJson} | jq .`;
const hasDefaultColors = /\u001b\[\d+/.test(defaultResult.stdout);
console.log('Exit code:', defaultResult.code);
console.log('Has ANSI color codes:', hasDefaultColors);
console.log('Output length:', defaultResult.stdout.length);
console.log(
  'First 150 chars (raw):',
  JSON.stringify(defaultResult.stdout.substring(0, 150))
);

// 4. Test with explicit color flag
console.log('\n4. JQ WITH EXPLICIT COLOR FLAG (-C):');
console.log('-'.repeat(40));
const colorResult = await $`echo ${testJson} | jq -C .`;
const hasExplicitColors = /\u001b\[\d+/.test(colorResult.stdout);
console.log('Has ANSI color codes:', hasExplicitColors);
console.log('Output length:', colorResult.stdout.length);
console.log(
  'First 150 chars (raw):',
  JSON.stringify(colorResult.stdout.substring(0, 150))
);

// 5. Test with explicit no-color flag
console.log('\n5. JQ WITH EXPLICIT NO-COLOR FLAG (-M):');
console.log('-'.repeat(40));
const noColorResult = await $`echo ${testJson} | jq -M .`;
const hasNoColors = /\u001b\[\d+/.test(noColorResult.stdout);
console.log('Has ANSI color codes:', hasNoColors);
console.log('Output length:', noColorResult.stdout.length);
console.log(
  'First 150 chars (raw):',
  JSON.stringify(noColorResult.stdout.substring(0, 150))
);

// 6. Test jq directly with Node's spawn (bypassing command-stream)
console.log('\n6. JQ DIRECTLY VIA NODE SPAWN:');
console.log('-'.repeat(40));
await new Promise((resolve) => {
  const echo = spawn('echo', [testJson]);
  const jq = spawn('jq', ['.']);

  let output = '';
  echo.stdout.pipe(jq.stdin);

  jq.stdout.on('data', (data) => {
    output += data.toString();
  });

  jq.on('close', () => {
    const hasSpawnColors = /\u001b\[\d+/.test(output);
    console.log('Has ANSI color codes:', hasSpawnColors);
    console.log('Output length:', output.length);
    console.log(
      'First 150 chars (raw):',
      JSON.stringify(output.substring(0, 150))
    );
    resolve();
  });
});

// 7. Test with environment variable manipulation
console.log('\n7. JQ WITH ENVIRONMENT VARIABLES:');
console.log('-'.repeat(40));

// Test with NO_COLOR
process.env.NO_COLOR = '1';
const noColorEnvResult = await $`echo ${testJson} | jq .`;
const hasNoColorEnv = /\u001b\[\d+/.test(noColorEnvResult.stdout);
console.log('With NO_COLOR=1, has colors:', hasNoColorEnv);
delete process.env.NO_COLOR;

// Test with FORCE_COLOR
process.env.FORCE_COLOR = '1';
const forceColorEnvResult = await $`echo ${testJson} | jq .`;
const hasForceColorEnv = /\u001b\[\d+/.test(forceColorEnvResult.stdout);
console.log('With FORCE_COLOR=1, has colors:', hasForceColorEnv);
delete process.env.FORCE_COLOR;

// 8. Summary and test recommendation
console.log('\n8. ANALYSIS AND RECOMMENDATION:');
console.log('-'.repeat(40));
console.log('Default behavior has colors:', hasDefaultColors);
console.log('Explicit -C has colors:', hasExplicitColors);
console.log('Explicit -M has colors:', hasNoColors);
console.log('Direct spawn has colors:', /\u001b\[\d+/.test(''));

if (hasDefaultColors && !process.stdout.isTTY) {
  console.log(
    '\n⚠️  UNEXPECTED: jq is outputting colors in non-TTY environment by default'
  );
  console.log('This might be due to:');
  console.log('  - jq configuration or alias');
  console.log('  - Environment variables affecting color output');
  console.log('  - Different jq version behavior');
} else if (!hasDefaultColors && process.stdout.isTTY) {
  console.log(
    '\n⚠️  UNEXPECTED: jq is NOT outputting colors in TTY environment by default'
  );
  console.log('This might be due to:');
  console.log("  - Pipe detection (jq sees it's in a pipe)");
  console.log('  - Environment variables suppressing colors');
} else {
  console.log('\n✅ jq behavior matches expected TTY detection');
}

console.log('\n9. RECOMMENDED TEST FIX:');
console.log('-'.repeat(40));
console.log('The test should handle both scenarios:');
console.log('  1. When jq auto-detects TTY and colors accordingly');
console.log('  2. When jq is affected by environment variables or config');
console.log('\nSuggested approach:');
console.log('  - Test explicit -C and -M flags (predictable behavior)');
console.log(
  '  - For default behavior, accept both colored and non-colored output'
);
console.log(
  '  - Focus on testing that output is valid JSON regardless of colors'
);

console.log(`\n${'='.repeat(60)}`);
console.log('DIAGNOSTIC COMPLETE');
console.log('='.repeat(60));
