#!/usr/bin/env node
// The Bun.$ API on Node.js, Bun and Deno, plus what command-stream adds on top.
//
//   node js/examples/bun-shell-portable.mjs
//   bun js/examples/bun-shell-portable.mjs
//   deno run -A --node-modules-dir=manual --no-lock \
//     js/examples/bun-shell-portable.mjs
//
// In your own code, import from the package: 'command-stream/bun' (Bun.$
// API) and 'command-stream' (streaming, virtual commands, `$.bun`).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, ShellError } from '../src/bun.mjs';
import { $ as stream, register, unregister } from '../src/$.mjs';

const runtime = globalThis.Bun
  ? `Bun ${globalThis.Bun.version}`
  : globalThis.Deno
    ? `Deno ${globalThis.Deno.version.deno}`
    : `Node.js ${process.version}`;
console.log(`# Running on ${runtime}\n`);

const dir = mkdtempSync(join(tmpdir(), 'bun-shell-example-'));
try {
  // 1. Bun.$ code, unchanged: interpolation is escaped, builtins are portable.
  const name = 'world; rm -rf /';
  console.log(await $`echo Hello ${name}`.text());

  // 2. Pipelines, redirects, globs and brace expansion, with no system shell.
  await $`mkdir -p src/{a,b} && touch src/a/one.txt src/b/two.txt`.cwd(dir);
  const files = await $`ls src/*/*.txt | wc -l`.cwd(dir).text();
  console.log(`files: ${files.trim()}`);

  // 3. JavaScript values as stdin / stdout.
  const input = Buffer.from('b\na\nc\n');
  console.log((await $`sort < ${input}`.text()).split('\n').join(' '));
  const out = new Uint8Array(5);
  await $`echo hello > ${out}`;
  console.log(`buffer: ${Buffer.from(out).toString()}`);

  // 4. Output helpers and errors, exactly as in Bun.
  const json = await $`echo '{"ok":true}'`.json();
  console.log('json:', json);
  for await (const line of $`printf 'x\ny\n'`.lines()) {
    if (line) {
      console.log('line:', line);
    }
  }
  try {
    await $`exit 3`.quiet();
  } catch (error) {
    console.log(error instanceof ShellError, error.message);
  }
  const { exitCode } = await $`exit 4`.nothrow().quiet();
  console.log('nothrow exit code:', exitCode);

  // 5. command-stream extras (not in Bun.$): real-time chunks and JavaScript
  //    functions registered as commands, usable in pipelines.
  register('shout', async ({ stdin }) => ({
    stdout: String(stdin).toUpperCase(),
    code: 0,
  }));
  const silent = stream({ mirror: false });
  for await (const chunk of silent`echo streamed | shout`.stream()) {
    if (chunk.type === 'stdout') {
      console.log(`chunk: ${chunk.data.toString().trim()}`);
    }
  }
  unregister('shout');

  // `$.bun` is the same Bun.$-compatible shell, from the main entry point.
  console.log('same shell:', stream.bun === $);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
