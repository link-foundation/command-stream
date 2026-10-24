#!/usr/bin/env node
import { $fy } from './commands/$.$fy.mjs';

export async function fyCli(args = process.argv.slice(2)) {
  let stdin;
  // Argument parsing determines whether a file takes precedence over stdin.
  const { parseFyArguments } = await import('./fy/cli-options.mjs');
  const { options, positional } = parseFyArguments(args);
  if (
    !options.help &&
    (!positional[0] || positional[0] === '-') &&
    !process.stdin.isTTY
  ) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    stdin = Buffer.concat(chunks).toString('utf8');
  }
  const result = await $fy({ args, stdin });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.code;
}
if (
  import.meta.main ||
  process.argv[1]?.replaceAll('\\', '/').endsWith('/fy-cli.mjs')
) {
  fyCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
