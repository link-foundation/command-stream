#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
const [mode, ...args] = process.argv.slice(2);
try {
  if (mode === 'repl') {
    const { startRepl, startRustRepl } = await import('./$.mjs');
    if (args[0] === '--language' && args[1] === 'rust' && args.length <= 3) {
      const controller = await startRustRepl({ cratePath: args[2] });
      const close = () =>
        controller.close().catch((error) => console.error(error));
      const interrupt = () => {
        if (!process.stdin.isTTY) {
          close();
        }
      };
      process.on('SIGINT', interrupt);
      process.once('SIGTERM', close);
      try {
        const result = await controller.done;
        process.exitCode = result.code ?? (result.signal === 'SIGTERM' ? 0 : 1);
      } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', close);
      }
    } else if (
      args.length === 0 ||
      (args[0] === '--language' &&
        args[1] === 'javascript' &&
        args.length === 2)
    ) {
      startRepl();
    } else {
      throw new Error(
        'Usage: command-stream repl [--language javascript|rust [crate-path]]'
      );
    }
  } else if (mode === 'fy') {
    const { fyCli } = await import('./fy-cli.mjs');
    await fyCli(args);
  } else if (mode === 'dev') {
    if (!args[0]) {
      throw new Error(
        'Usage: command-stream dev script.mjs|Cargo.toml [watch-glob ...] [--repl]'
      );
    }
    const { dev } = await import('./$.mjs');
    const language = args[0].endsWith('Cargo.toml') ? 'rust' : 'javascript';
    const watch = args.slice(1).filter((argument) => argument !== '--repl');
    const controller = dev({
      entry: resolve(args[0]),
      cwd: language === 'rust' ? dirname(resolve(args[0])) : process.cwd(),
      watch: watch.length
        ? watch
        : language === 'rust'
          ? ['**/*.rs', '**/Cargo.toml', '**/Cargo.lock']
          : [args[0]],
      initial: true,
      repl: args.includes('--repl') || Boolean(process.stdin.isTTY),
      language,
    });
    await controller.ready;
    const close = () => {
      controller.close().catch((error) => console.error(error));
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    if (language === 'rust') {
      controller.repl?.done.finally(close).catch(console.error);
    } else {
      controller.repl?.once('exit', close);
    }
  } else {
    const { main } = await import('./zx/cli.mjs');
    await main();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
