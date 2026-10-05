// Synchronous launch-time probes from a CommonJS host (issue #189).
//
// A CommonJS process cannot await at module scope, so `await import(...)` is not
// an option for a probe that has to answer before the host finishes booting.
// `require('command-stream')` returns the `$` tagged template synchronously, so
// `.sync()` can be used directly in that boundary.
//
// Run with: node js/examples/commonjs-launch-probe.cjs

'use strict';

// Installed consumers write require('command-stream'); this example is run from
// inside the repository, so it points at the CommonJS entry point directly.
const $ = require('../src/$.cjs');

// `mirror: false` keeps probe output out of the host's own stdout.
const probe = $({ mirror: false });

/**
 * Check whether a command exists and report the version it prints.
 *
 * @param {string} tool Executable name, e.g. 'git'.
 * @returns {{ available: boolean, version: string | null }} Probe outcome.
 */
function probeTool(tool) {
  const result = probe`${tool} --version`.sync();
  return {
    available: result.code === 0,
    version: result.code === 0 ? result.stdout.trim().split('\n')[0] : null,
  };
}

const tools = ['git', 'node', 'definitely-not-installed-tool'];

console.log('Launch-time probes (fully synchronous, no await):');
for (const tool of tools) {
  const { available, version } = probeTool(tool);
  console.log(`  ${tool}: ${available ? version : 'not available'}`);
}

// The named exports are attached to the same value, so both shapes work.
const { sh, ProcessRunner } = require('../src/$.cjs');
console.log('sh is a function:', typeof sh === 'function');
console.log(
  'probe returns a ProcessRunner:',
  probe`true` instanceof ProcessRunner
);
