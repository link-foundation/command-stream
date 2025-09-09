#!/usr/bin/env node

import { $ } from './$.mjs';
import { parseArgs } from 'util';

const CLI_VERSION = '0.7.1';

function showHelp() {
  console.log(`
$ CLI Tool - Command Stream Shell Utility
Version: ${CLI_VERSION}

Usage:
  $ -c 'command'          Execute command with virtual commands support
  $ --command 'command'   Execute command with virtual commands support
  $ --help               Show this help message
  $ --version            Show version information

Examples:
  $ -c 'echo "Hello World"'
  $ -c 'ls | grep .js'
  $ -c 'cd /tmp && pwd'
  $ -c 'seq 1 5 | cat'

Virtual commands available: cd, echo, ls, cat, seq, sleep, pwd, which, and more.
`);
}

function showVersion() {
  console.log(`$ CLI Tool v${CLI_VERSION}`);
}

async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        'c': {
          type: 'string',
          short: 'c'
        },
        'command': {
          type: 'string'
        },
        'help': {
          type: 'boolean'
        },
        'version': {
          type: 'boolean'
        }
      },
      allowPositionals: true
    });

    if (values.help) {
      showHelp();
      process.exit(0);
    }

    if (values.version) {
      showVersion();
      process.exit(0);
    }

    const command = values.c || values.command;

    if (!command) {
      console.error('Error: No command specified. Use -c or --command to provide a command.');
      console.error('Use --help for usage information.');
      process.exit(1);
    }

    // Execute the command using the $ template literal
    // We simulate the template literal by creating an array with the command
    // This mimics how template literals are processed
    const result = await $([command]);

    // Exit with the same code as the executed command
    process.exit(result.code || 0);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});