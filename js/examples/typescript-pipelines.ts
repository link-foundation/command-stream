#!/usr/bin/env bun
/**
 * TypeScript: pipelines.
 *
 * Both shell pipelines inside a template and `.pipe()` chains return a
 * `ProcessRunner`, so results stay typed end to end.
 */

import { $, type ProcessRunner, type StreamResult } from 'command-stream';

const quiet = $({ mirror: false });

// A pipeline written in the template.
const inline: StreamResult = await quiet`echo ${'b\na\nc'} | sort`;
console.log(
  `template pipeline -> ${inline.stdout?.trim().split('\n').join(',')}`
);

// A programmatic pipeline built with `.pipe()`.
const upper = `process.stdin.on('data', (d) => process.stdout.write(d.toString().toUpperCase()))`;
const chain: ProcessRunner = quiet`echo ${'piped through node'}`.pipe(
  quiet`${process.execPath} -e ${upper}`
);
const piped = await chain;
console.log(`pipe() -> ${piped.stdout?.trim()} (exit ${piped.code})`);
