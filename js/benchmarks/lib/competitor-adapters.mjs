import crossSpawn from 'cross-spawn';
import { execa } from 'execa';
import shelljs from 'shelljs';
import { $ as zxShell } from 'zx';
import { readFileSync } from 'node:fs';
import { exec as commandStreamExec } from '../../src/$.mjs';
import { $ as commandStreamBunShell } from '../../src/bun.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);

const packageVersion = (name) =>
  name === 'command-stream'
    ? manifest.version
    : (manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]);

export const EXPECTED_ADAPTERS = [
  'command-stream',
  'command-stream/bun',
  'execa',
  'cross-spawn',
  'ShellJS',
  'zx',
  'Bun.$',
];

const asText = (value) =>
  value === undefined || value === null
    ? ''
    : Buffer.isBuffer(value)
      ? value.toString('utf8')
      : String(value);

const normalizedResult = ({ stdout, stderr, exitCode, code }) => ({
  stdout: asText(stdout),
  stderr: asText(stderr),
  exitCode: Number(exitCode ?? code ?? 0),
});

export const executableForZx = (file, platform = process.platform) =>
  // zx 8 uses Bash on Windows; MSYS Bash can execute drive paths with forward
  // slashes, while native backslashes are parsed as shell escapes.
  platform === 'win32' ? file.replaceAll('\\', '/') : file;

function spawnWithCrossSpawn(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) =>
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: exitCode ?? 1,
      })
    );
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

function quoteShellArgument(value) {
  const text = String(value);
  if (process.platform === 'win32') {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function runWithShellJs(file, args, options) {
  if (options.input !== undefined) {
    throw new Error('ShellJS adapter does not support stdin workloads');
  }
  const command = [file, ...args].map(quoteShellArgument).join(' ');
  return new Promise((resolve) => {
    shelljs.exec(
      command,
      { async: true, cwd: options.cwd, env: options.env, silent: true },
      (exitCode, stdout, stderr) => resolve({ stdout, stderr, exitCode })
    );
  });
}

/**
 * Run through a Bun.$-style tagged template (Bun.$ itself, or its portable
 * port `command-stream/bun`). Input is passed as a `< ${buffer}` redirect.
 */
async function runBunStyle(shell, file, args, options) {
  let command =
    options.input === undefined
      ? shell`${file} ${args}`
      : shell`${file} ${args} < ${Buffer.from(options.input)}`;
  command = command.quiet().nothrow();
  if (options.cwd) {
    command = command.cwd(options.cwd);
  }
  if (options.env) {
    command = command.env(options.env);
  }
  return normalizedResult(await command);
}

async function createBunAdapter() {
  if (typeof globalThis.Bun === 'undefined') {
    return null;
  }
  const { $: bunShell } = await import('bun');
  return {
    name: 'Bun.$',
    version: globalThis.Bun.version,
    run: (file, args, options = {}) =>
      runBunStyle(bunShell, file, args, options),
  };
}

export async function loadCompetitorAdapters() {
  const adapters = [
    {
      name: 'command-stream',
      version: packageVersion('command-stream'),
      async run(file, args, options = {}) {
        return normalizedResult(
          await commandStreamExec(file, args, {
            capture: true,
            mirror: false,
            stdin: options.input ?? 'ignore',
            cwd: options.cwd,
            env: options.env,
          })
        );
      },
    },
    {
      name: 'command-stream/bun',
      version: packageVersion('command-stream'),
      run: (file, args, options = {}) =>
        runBunStyle(commandStreamBunShell, file, args, options),
    },
    {
      name: 'execa',
      version: packageVersion('execa'),
      async run(file, args, options = {}) {
        return normalizedResult(
          await execa(file, args, {
            cwd: options.cwd,
            env: options.env,
            input: options.input,
            reject: false,
          })
        );
      },
    },
    {
      name: 'cross-spawn',
      version: packageVersion('cross-spawn'),
      run: (file, args, options = {}) =>
        spawnWithCrossSpawn(file, args, options),
    },
    {
      name: 'ShellJS',
      version: packageVersion('shelljs'),
      run: (file, args, options = {}) => runWithShellJs(file, args, options),
    },
    {
      name: 'zx',
      version: packageVersion('zx'),
      async run(file, args, options = {}) {
        if (options.input !== undefined) {
          throw new Error('zx adapter does not support stdin workloads');
        }
        const result = await zxShell({
          cwd: options.cwd,
          env: options.env,
          nothrow: true,
          quiet: true,
          verbose: false,
        })`${executableForZx(file)} ${args}`;
        return normalizedResult(result);
      },
    },
  ];
  const bunAdapter = await createBunAdapter();
  if (bunAdapter) {
    adapters.push(bunAdapter);
  }
  return adapters;
}
