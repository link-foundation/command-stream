#!/usr/bin/env node
// Stream to both console and file simultaneously
import { $ } from '../js/src/$.mjs';
import { appendFileSync } from 'fs';

const logFile = 'stream-output.log';
let chunks = 0;

$`claude "Say hello 3 times"`
  .on('data', (chunk) => {
    const data = chunk.data.toString();
    console.log(`Console: ${data.trim()}`);
    appendFileSync(logFile, `Chunk ${++chunks}: ${data}`);
  })
  .on('end', () => console.log(`Saved ${chunks} chunks to ${logFile}`))
  .start();
