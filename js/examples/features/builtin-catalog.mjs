// command-stream ships built-in implementations of common shell commands, so
// scripts behave the same even where those binaries are missing.
import {
  $,
  listCommands,
  enableVirtualCommands,
  disableVirtualCommands,
} from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'builtin-catalog', title: 'The built-in command catalog' },
  async ({ record }) => {
    record('available built-ins', listCommands().sort());
    record('number of built-ins', listCommands().length);

    // Built-ins can be switched off, which falls back to the real binaries.
    record('with built-ins', (await $q`echo built-in`).stdout);
    disableVirtualCommands();
    record('with built-ins disabled', (await $q`echo real binary`).stdout);
    enableVirtualCommands();
    record('built-ins enabled again', listCommands().length > 0);
  }
);
