#!/usr/bin/env node
// Claude output piped to jq for JSON processing
import { $ } from '../js/src/$.mjs';

console.log('Claude → jq pipeline:');

// Ask Claude for JSON output and pipe to jq
$`claude "Output a simple JSON object with name and age fields" --output-format json`
  .pipe($`jq -r '.name'`)
  .on('data', (chunk) => {
    console.log(`jq result: ${chunk.data.toString().trim()}`);
  })
  .on('end', (result) => {
    console.log(`Pipeline complete, exit: ${result.code}`);
  })
  .start();
