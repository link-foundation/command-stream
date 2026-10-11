#!/usr/bin/env bun
/**
 * TypeScript: type-safe virtual command registration.
 *
 * Handlers are checked against `VirtualCommandHandler`: a function returning
 * `{ code?, stdout?, stderr? }`, or an `async function*` yielding text or
 * bytes. Arguments and stdin are typed in the context.
 */

import {
  $,
  listCommands,
  register,
  unregister,
  type VirtualCommandHandler,
} from 'command-stream';

const greet: VirtualCommandHandler = async ({ args }) => ({
  stdout: `Hello, ${args[0] ?? 'world'}!\n`,
});

const shout: VirtualCommandHandler = ({ stdin }) => ({
  stdout: stdin.toUpperCase(),
  code: 0,
});

async function* countdown({
  args,
  isCancelled,
}: Parameters<VirtualCommandHandler>[0]) {
  for (let i = Number(args[0] ?? 3); i > 0; i--) {
    if (isCancelled?.()) {
      return;
    }
    yield `${i}\n`;
  }
  yield Buffer.from('liftoff\n');
}

register('ts-greet', greet);
register('ts-shout', shout);
register('ts-countdown', countdown);

try {
  const quiet = $({ mirror: false });
  const hello = await quiet`ts-greet ${'TypeScript'}`;
  console.log(`greet -> ${hello.stdout?.trim()}`);

  const loud = await quiet`ts-greet types | ts-shout`;
  console.log(`pipeline -> ${loud.stdout?.trim()}`);

  const counted = await quiet`ts-countdown 2`;
  console.log(`generator -> ${counted.stdout?.trim().split('\n').join(' ')}`);

  const registered = listCommands().filter((name) => name.startsWith('ts-'));
  console.log(`registered -> ${registered.sort().join(', ')}`);
} finally {
  for (const name of ['ts-greet', 'ts-shout', 'ts-countdown']) {
    unregister(name);
  }
}
