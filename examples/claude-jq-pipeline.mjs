#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('🤖 Claude → jq streaming pipeline');

// Claude with JSON output piped to jq
let events = 0;
for await (const chunk of $`claude "say hi" --output-format stream-json | jq -r '.type // empty'`.stream()) {
  console.log(`📦 Event ${++events}: ${chunk.data.toString().trim()}`);
}

console.log(`✅ Pipeline completed with ${events} events`);
