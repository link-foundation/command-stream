#!/usr/bin/env node

import { repl } from '../src/repl.mjs';
import { dev } from '../src/dev.mjs';

const command = process.argv[2];

switch (command) {
  case 'repl':
    await repl();
    break;
  case 'dev':
    await dev();
    break;
  default:
    console.log(`
command-stream - Modern shell utility library

Usage:
  npx command-stream repl    Start interactive REPL
  npx command-stream dev     Start development mode

Options:
  --help, -h                 Show this help message
`);
    process.exit(1);
}