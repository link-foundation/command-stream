#!/usr/bin/env node
// Simple Claude test with command-stream
import { $ } from '../src/$.mjs';

console.log('=== Simple Claude test with command-stream ===');

let chunkCount = 0;

$`claude hi`
  .on('data', (chunk) => {
    chunkCount++;
    console.log(`Stream chunk ${chunkCount}:`, chunk.data.toString());
  })
  .on('end', (result) => {
    console.log(`Command-stream: ${chunkCount} chunks, exit: ${result.code}`);
  })
  .start();