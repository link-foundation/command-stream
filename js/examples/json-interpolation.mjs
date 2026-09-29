#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $ } from '../src/$.mjs';

const data = {
  name: 'Test Project',
  description: 'A project with "quotes" and apostrophes',
  config: {
    special: 'Value with `backticks`, $variables, and C:\\Program Files',
  },
};
const json = JSON.stringify(data, null, 2);
const directory = await mkdtemp(path.join(os.tmpdir(), 'command-stream-json-'));

try {
  const shellOutput = path.join(directory, 'from shell.json');

  // Interpolate JSON directly. It becomes one literal argument, so no manual
  // quote escaping is needed. printf is preferable to echo when bytes matter.
  await $({ mirror: false })`printf '%s' ${json} > ${shellOutput}`;
  const roundTrip = JSON.parse(await readFile(shellOutput, 'utf8'));
  console.log('Shell command round trip:', roundTrip);

  // If no command needs the data, skip the shell entirely.
  const directOutput = path.join(directory, 'from JavaScript.json');
  await writeFile(directOutput, json);
  console.log(
    'Direct write round trip:',
    JSON.parse(await readFile(directOutput))
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
