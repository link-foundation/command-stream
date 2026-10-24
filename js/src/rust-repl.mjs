import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  realpath,
  stat,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './$.trace.mjs';
import { killChildProcess } from './$.process-runner-stream-kill.mjs';

/** Start the real Rust evaluator with the complete command-stream crate loaded. */
export async function startRustRepl({
  executable = process.env.COMMAND_STREAM_EVCXR || 'evcxr',
  args = [],
  cratePath,
  stdio = 'inherit',
  disableReadline = !process.stdin.isTTY,
} = {}) {
  const local = fileURLToPath(new URL('../../rust/', import.meta.url));
  if (cratePath === undefined) {
    try {
      await stat(join(local, 'Cargo.toml'));
      cratePath = local;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  const dependency = cratePath
    ? `path = ${JSON.stringify(await realpath(cratePath))}`
    : 'version = "1.6"';
  const directory = await mkdtemp(join(tmpdir(), '.command-stream-repl-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const facade = join(directory, 'facade');
    await mkdir(facade);
    await writeFile(
      join(facade, 'Cargo.toml'),
      `[package]\nname = "command-stream-repl-context"\nversion = "0.0.0"\nedition = "2021"\n[lib]\npath = "lib.rs"\ncrate-type = ["dylib"]\n[dependencies]\ncommand_stream = { package = "command-stream", ${dependency} }\ntokio = { version = "1", features = ["full"] }\n`
    );
    await writeFile(
      join(facade, 'lib.rs'),
      'pub use command_stream::*;\npub use tokio;\n'
    );
    await writeFile(
      join(directory, 'init.evcxr'),
      // The facade shares Tokio's process/signal state across evaluated cells.
      `:opt 0\n:dep command_stream = { package = "command-stream-repl-context", path = ${JSON.stringify(facade)} }\n:dep tokio = { version = "1", features = ["full"] }\n`
    );
    await writeFile(join(directory, 'prelude.rs'), 'use command_stream::*;\n');
    const child = spawn(
      executable,
      [...args, ...(disableReadline ? ['--disable-readline'] : [])],
      {
        stdio,
        detached: process.platform !== 'win32' && disableReadline,
        env: { ...process.env, EVCXR_CONFIG_DIR: directory },
      }
    );
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    }).finally(cleanup);
    // Callers can attach their own completion handler after the spawn promise.
    done.catch(() => {});
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    trace('Development', () => `Rust REPL started: ${child.pid}`);
    return {
      child,
      done,
      async close() {
        if (child.exitCode === null && child.signalCode === null) {
          // Keep completion listeners while reusing the runner's tree cleanup.
          killChildProcess({ pid: child.pid, kill: () => child.kill() });
        }
        await done;
      },
    };
  } catch (error) {
    await cleanup();
    throw new Error(
      `Cannot start Rust REPL: ${error.message}. Install Rust sources with \`rustup component add rust-src\` and the evaluator with \`cargo install --locked evcxr_repl\`, or set COMMAND_STREAM_EVCXR.`,
      { cause: error }
    );
  }
}
