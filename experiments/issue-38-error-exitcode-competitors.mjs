// Which property carries the exit status of a failing command?
// Node.js `child_process` names it `code`, while Execa, zx, nano-spawn and the
// Bun shell name it `exitCode`. Issue #38 asks command-stream to answer to both
// names, so this probe prints what every implementation actually exposes.
// Optional packages are reported as unavailable instead of being required by
// this repository.
//
// References:
//   https://github.com/link-foundation/command-stream/issues/38
//   https://nodejs.org/api/child_process.html#child_processexeccommand-options-callback
//   https://github.com/sindresorhus/execa/blob/main/docs/errors.md
//   https://google.github.io/zx/process-output
//   https://bun.com/docs/runtime/shell
//
// Run: bun experiments/issue-38-error-exitcode-competitors.mjs

import { exec as nodeExec } from 'node:child_process';
import { $, shell } from '../js/src/$.mjs';

const EXIT_CODE = 23;
const FAILING_COMMAND = `node -e "process.exit(${EXIT_CODE})"`;

async function optionalImport(name) {
  try {
    return await import(name);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

// Returns the value thrown (or resolved) by a failing command, or null when the
// implementation is not installed here.
async function commandStream() {
  shell.errexit(true);
  try {
    return await $({ mirror: false })`node -e "process.exit(${EXIT_CODE})"`;
  } catch (error) {
    return error;
  } finally {
    shell.errexit(false);
  }
}

function nodeChildProcess() {
  return new Promise((resolve) => {
    nodeExec(FAILING_COMMAND, (error) => resolve(error));
  });
}

async function bunShell() {
  if (typeof Bun === 'undefined') {
    return null;
  }
  const { $: bun$ } = await import('bun');
  try {
    return await bun$`node -e ${`process.exit(${EXIT_CODE})`}`.quiet();
  } catch (error) {
    return error;
  }
}

async function zx() {
  const module = await optionalImport('zx');
  if (!module) {
    return null;
  }
  try {
    return await module.$({
      quiet: true,
    })`node -e ${`process.exit(${EXIT_CODE})`}`;
  } catch (error) {
    return error;
  }
}

async function execa() {
  const module = await optionalImport('execa');
  if (!module) {
    return null;
  }
  try {
    return await module.execa('node', ['-e', `process.exit(${EXIT_CODE})`]);
  } catch (error) {
    return error;
  }
}

async function nanoSpawn() {
  const module = await optionalImport('nano-spawn');
  if (!module) {
    return null;
  }
  try {
    return await module.default('node', ['-e', `process.exit(${EXIT_CODE})`]);
  } catch (error) {
    return error;
  }
}

const implementations = [
  ['command-stream', commandStream],
  ['Node.js exec', nodeChildProcess],
  ['Bun shell', bunShell],
  ['zx', zx],
  ['Execa', execa],
  ['nano-spawn', nanoSpawn],
];

const describe = (value) => {
  const has = (name) =>
    value?.[name] === undefined ? '-' : String(value[name]);
  return `code=${has('code').padEnd(6)} exitCode=${has('exitCode')}`;
};

console.log(`failing command: ${FAILING_COMMAND}\n`);

let failures = 0;
for (const [name, run] of implementations) {
  const thrown = await run();
  if (thrown === null) {
    console.log(`  ${name.padEnd(14)} unavailable`);
    continue;
  }
  console.log(`  ${name.padEnd(14)} ${describe(thrown)}`);

  if (name === 'command-stream') {
    // command-stream must satisfy both conventions at once (issue #38).
    if (thrown.code !== EXIT_CODE || thrown.exitCode !== EXIT_CODE) {
      failures += 1;
    }
  }
}

process.exitCode = failures === 0 ? 0 : 1;
