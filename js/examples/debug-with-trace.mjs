#!/usr/bin/env node

// Set trace before importing
process.env.COMMAND_STREAM_TRACE = 'all';
process.env.COMMAND_STREAM_VERBOSE = 'true';

import { $ } from '../src/$.mjs';

async function debugWithTrace() {
  console.log('🐛 Testing with full tracing enabled');

  const sortCmd = $`echo "test" | sort`;
  console.log('Created command');

  try {
    const result = await sortCmd;
    console.log('Result:', result);
  } catch (error) {
    console.log('Error:', error.message);
  }
}

debugWithTrace();
