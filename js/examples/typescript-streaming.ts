#!/usr/bin/env bun
/**
 * TypeScript: typed events and streaming chunks.
 *
 * `stream()` yields a discriminated union, so narrowing on `chunk.type`
 * gives `Buffer` data for output chunks and a numeric code for `exit`.
 */

import { $, type OutputChunk, type StreamChunk } from 'command-stream';

const script = "console.log('one'); console.error('two'); console.log('three')";

// Async iteration over typed chunks.
const collected: string[] = [];
for await (const chunk of $({
  mirror: false,
})`${process.execPath} -e ${script}`.stream()) {
  const item: StreamChunk = chunk;
  if (item.type === 'exit') {
    collected.push(`exit:${item.code}`);
  } else {
    collected.push(`${item.type}:${item.data.toString().trim()}`);
  }
}
console.log(`stream -> ${collected.sort().join(', ')}`);

// Typed event listeners: payloads are inferred from the event name.
const seen: OutputChunk[] = [];
let exitCode = -1;
const runner = $({ mirror: false })`${process.execPath} -e ${script}`
  .on('data', (chunk) => {
    seen.push(chunk);
  })
  .on('exit', (code) => {
    exitCode = code;
  });
await runner;
console.log(`events -> ${seen.length} data chunks, exit ${exitCode}`);
