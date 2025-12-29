#!/usr/bin/env node
// Basic streaming example - shows real-time chunk processing
import { $ } from '../js/src/$.mjs';

let chunkCount = 0;

$`claude "Count from 1 to 3 briefly"`
  .on('data', (chunk) => {
    console.log(`Chunk ${++chunkCount}: ${chunk.data.toString().trim()}`);
  })
  .on('end', (result) =>
    console.log(`Done! ${chunkCount} chunks, exit: ${result.code}`)
  )
  .start();
