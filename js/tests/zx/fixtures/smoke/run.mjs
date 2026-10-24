// Runs a smoke fixture in a child process of the current runtime (node or
// bun) and resolves with its exit code and output (issue #26).
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const smokeFixture = (name) => path.join(__dirname, name);

export const runFixture = (file, { bin = process.execPath, args = [] } = {}) =>
  new Promise((resolve) => {
    execFile(
      bin,
      [...args, file],
      {
        timeout: 60_000,
        // DENO_NO_PACKAGE_JSON stops Deno from resolving the dev dependencies.
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          DENO_NO_PACKAGE_JSON: '1',
        },
      },
      (error, stdout, stderr) =>
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr })
    );
  });
