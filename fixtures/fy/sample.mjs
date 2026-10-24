#!/usr/bin/env node
import { $, shell } from 'command-stream';

const args = process.argv.slice(2);
let TARGET;

// deploy helper
shell.set("e");

TARGET = `${args[0] ?? `staging`}`;
process.env.REGION = `eu`;

async function deploy(...args) {
  let tag = ``;
  tag = `${(await $`git rev-parse --short HEAD`).stdout.trim()}`;
  await $`echo "deploying ${tag} to ${TARGET}" | tee deploy.log`;
}

if ((await $`[ -d dist ]`).code === 0) {
  await $`deploy`;
} else {
  await $`echo "nothing to deploy" >&2`;
}

for (const env of [`staging`, `prod`]) {
  await $`echo "${env}"`;
}

switch (`${TARGET}`) {
  case `staging`:
    await $`deploy`;
    break;
  default:
    await $`echo unknown`;
    break;
}

if ((await $`ls && echo ok`).code !== 0) {
  await $`echo failed`;
}
process.exit(0);
