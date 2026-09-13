// Compare multiline interpolation with /bin/sh and current shell libraries.
// Optional competitors can be installed outside the repository and supplied as:
// COMPETITOR_NODE_MODULES=/tmp/deps/node_modules bun experiments/issue-37-multiline-competitors.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { $ } from '../js/src/$.mjs';

const CONTENT = `# Test Repository

Literal \`backticks\`, "double quotes", 'single quotes', $HOME, \${name},
C:\\Program Files\\Example, and $(printf never-executed).`;

async function importOptional(name) {
  const modules = process.env.COMPETITOR_NODE_MODULES;
  if (modules) {
    try {
      return await import(
        pathToFileURL(path.join(path.resolve(modules), name)).href
      );
    } catch {
      // Fall through to normal package resolution.
    }
  }

  try {
    return await import(name);
  } catch {
    return null;
  }
}

const expected = execFileSync('/bin/sh', ['-c', `printf '%s' "$V"`], {
  encoding: 'utf8',
  env: { ...process.env, V: CONTENT },
});

const runners = {
  'command-stream': async () =>
    (await $({ mirror: false })`printf %s ${CONTENT}`).stdout,
  'Bun Shell': async () => {
    if (typeof Bun === 'undefined') {
      return null;
    }
    const { $: bunShell } = await import('bun');
    return (await bunShell`printf %s ${CONTENT}`.quiet()).stdout.toString();
  },
  zx: async () => {
    const zx = await importOptional('zx');
    if (!zx?.$) {
      return null;
    }
    return (await zx.$({ quiet: true })`printf %s ${CONTENT}`).stdout;
  },
  execa: async () => {
    const execa = await importOptional('execa');
    if (!execa?.execa) {
      return null;
    }
    return (await execa.execa`printf %s ${CONTENT}`).stdout;
  },
};

let failed = false;
for (const [name, run] of Object.entries(runners)) {
  try {
    const actual = await run();
    if (actual === null) {
      console.log(`SKIP ${name} (not installed)`);
    } else if (actual === expected) {
      console.log(`PASS ${name}`);
    } else {
      failed = true;
      console.error(`FAIL ${name}: ${JSON.stringify(actual)}`);
    }
  } catch (error) {
    failed = true;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

if (failed) {
  process.exitCode = 1;
}
