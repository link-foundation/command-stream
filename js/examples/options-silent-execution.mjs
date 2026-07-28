#!/usr/bin/env node

// Silent execution - disable mirroring

import { $ } from '../src/$.mjs';

console.log('Silent execution - disable mirroring:');
console.log('await $`echo "silent"`.start({ mirror: false })');
const result = await $`echo "This won't show on console but is captured"`.start(
  { mirror: false }
);
console.log(
  `Exit code: ${result.code}, Captured: ${JSON.stringify(result.stdout)}`
);
