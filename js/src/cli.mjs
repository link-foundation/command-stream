#!/usr/bin/env node
const [mode, ...args] = process.argv.slice(2);
try {
  if (mode === 'repl') {
    const { startRepl } = await import('./$.mjs');
    startRepl();
  } else if (mode === 'fy') {
    const { fyCli } = await import('./fy-cli.mjs');
    await fyCli(args);
  } else if (mode === 'dev') {
    if (!args[0]) {
      throw new Error('Usage: command-stream dev script.mjs [watch-glob ...]');
    }
    const { dev } = await import('./$.mjs');
    const controller = dev({
      entry: args[0],
      watch: args.slice(1).length ? args.slice(1) : [args[0]],
      initial: true,
      repl: Boolean(process.stdin.isTTY),
    });
    await controller.ready;
    const close = () => {
      controller.close().catch((error) => console.error(error));
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } else {
    const { main } = await import('./zx/cli.mjs');
    await main();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
