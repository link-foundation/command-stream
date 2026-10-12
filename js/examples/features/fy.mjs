import { fy } from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'fy', title: 'Translate shell programs into modules' },
  async ({ record }) => {
    const module = fy('echo "$1"; exit 7');
    record(
      'source preserved',
      module.includes(JSON.stringify('echo "$1"; exit 7'))
    );
    record('executable module', module.startsWith('#!/usr/bin/env node\n'));
  }
);
