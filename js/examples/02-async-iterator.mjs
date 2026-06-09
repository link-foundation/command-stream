#!/usr/bin/env node
// Async iterator pattern - process chunks as they arrive
import { $ } from '../src/$.mjs';

console.log('Using async iteration:');

for await (const chunk of $`claude "List 3 colors"`.stream()) {
  console.log(`→ ${chunk.data.toString().trim()}`);
}
