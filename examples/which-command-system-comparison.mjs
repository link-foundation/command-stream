#!/usr/bin/env node

// Comparing with system /usr/bin/which

import { $ } from '../js/src/$.mjs';

console.log('Comparing with system /usr/bin/which:');
try {
  const systemResult = await $`/usr/bin/which gh`;
  const builtinResult = await $`which gh`;

  console.log(`System which exit code: ${systemResult.code}`);
  console.log(`Builtin which exit code: ${builtinResult.code}`);
  console.log(`System which output: ${systemResult.stdout.trim()}`);
  console.log(`Builtin which output: ${builtinResult.stdout.trim()}`);

  if (systemResult.code === builtinResult.code) {
    console.log(
      '✅ SUCCESS: Exit codes match between system and builtin which'
    );
  } else {
    console.log(
      '❌ FAILED: Exit codes differ between system and builtin which'
    );
  }
} catch (error) {
  console.log('❌ ERROR:', error.message);
}
