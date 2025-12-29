#!/usr/bin/env bun

import { $ } from '../js/src/$.mjs';

// Add debug logging
const original_runPipeline = $.prototype._runPipeline;
$.prototype._runPipeline = async function (commands) {
  console.log(
    'Pipeline commands:',
    commands.map((c) => c.cmd)
  );
  const result = await original_runPipeline.call(this, commands);
  return result;
};

const original_runStreamingPipelineBun = $.prototype._runStreamingPipelineBun;
$.prototype._runStreamingPipelineBun = async function (commands) {
  const hasJq = commands.some((c) => c.cmd === 'jq');
  const hasVirtual = commands.some((c) => c.isVirtual);
  console.log(
    `Streaming pipeline: hasJq=${hasJq}, hasVirtual=${hasVirtual}, platform=${process.platform}`
  );

  const result = await original_runStreamingPipelineBun.call(this, commands);
  return result;
};

console.log('Testing pipeline routing:\n');

// Test with actual file to avoid shell wrapper
console.log('Test 1: Using actual file command:');
const start = Date.now();
for await (const chunk of $`./js/examples/emulate-claude-stream.mjs | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const lines = chunk.data.toString().trim().split('\n').slice(0, 2);
    console.log(`[${elapsed}ms] First lines:`, lines);
  }
}

console.log('\nTest 2: Using bun run:');
const start2 = Date.now();
for await (const chunk of $`bun run js/examples/emulate-claude-stream.mjs | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start2;
    const lines = chunk.data.toString().trim().split('\n').slice(0, 2);
    console.log(`[${elapsed}ms] First lines:`, lines);
  }
}
