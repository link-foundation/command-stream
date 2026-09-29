// Helpers for the zx build-artifact ports (issue #26): pack the npm tarball
// once, unpack it without a `tar` binary, and stage throwaway consumer
// projects that load the packed copy instead of the working tree.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '../../../..');
export const IS_WIN = process.platform === 'win32';

// Packing and compiling are slow on CI runners; `bun test --timeout` would
// otherwise cut the first test short.
export const IT_TIMEOUT = 180_000;

// Every module the `command-stream/zx/core` entry reaches, the counterpart of
// the file list upstream's `zx@lite` package ships.
export const LITE_FILES = [
  'src/zx/core.cjs',
  'src/zx/core.mjs',
  'src/zx/error.mjs',
  'src/zx/internals.mjs',
  'src/zx/load.cjs',
  'src/zx/log.mjs',
  'src/zx/process-output.mjs',
  'src/zx/process-promise.mjs',
  'src/zx/spawn.mjs',
  'src/zx/util.mjs',
  'src/zx/vendor-core.mjs',
  'src/zx/vendor/chalk.mjs',
  'src/zx/vendor/ps.mjs',
  'src/zx/vendor/which.mjs',
];

export const tempdir = (prefix = 'cs-zx-it-') =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/**
 * Run a command and resolve with its exit code and output; `all` keeps the
 * stdout/stderr interleaving, like zx's `ProcessOutput#text()`.
 */
export const run = (bin, args, { cwd, input, env } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
      // `npm`, `tsc` and `esbuild` are `.cmd` shims on Windows.
      shell: IS_WIN && (!path.isAbsolute(bin) || bin.endsWith('.cmd')),
    });
    const out = { stdout: '', stderr: '', all: '' };
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', (chunk) => {
        out[stream] += chunk;
        out.all += chunk;
      });
    }
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, ...out }));
    child.stdin.end(input);
  });

/** `run`, rejecting with the captured output when the command fails. */
export const runOk = async (bin, args, opts) => {
  const result = await run(bin, args, opts);
  if (result.code !== 0) {
    throw new Error(
      `${bin} ${args.join(' ')} exited with ${result.code}\n${result.all}`
    );
  }
  return result;
};

/**
 * Path of a dev tool installed in js/node_modules/.bin. On Windows npm writes
 * `.cmd` shims there and `bun install` writes `.exe` ones.
 */
export const devBin = (name) => {
  const bin = path.join(ROOT, 'node_modules', '.bin', name);
  if (!IS_WIN) {
    return bin;
  }
  const shims = [`${bin}.exe`, `${bin}.cmd`];
  return shims.find((shim) => fs.existsSync(shim)) ?? shims[1];
};

const readString = (buf, start, length) =>
  buf.toString('utf8', start, start + length).replace(/\0[\s\S]*$/, '');

const paxPath = (body) => {
  const match = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
  return match ? match[1] : null;
};

const writeEntry = (dest, name, type, body) => {
  const target = path.resolve(dest, name);
  if (!target.startsWith(path.resolve(dest) + path.sep)) {
    throw new Error(`refusing to unpack ${name} outside ${dest}`);
  }
  if (type === '5') {
    fs.mkdirSync(target, { recursive: true });
  } else if (type === '0' || type === '\0') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
};

/** Unpack a gzipped ustar/pax archive, the format `npm pack` writes. */
export const untar = (tarball, dest) => {
  const data = zlib.gunzipSync(fs.readFileSync(tarball));
  let pending = null;
  for (let offset = 0; offset + 512 <= data.length;) {
    if (data.subarray(offset, offset + 512).every((byte) => byte === 0)) {
      break;
    }
    const size = parseInt(readString(data, offset + 124, 12).trim(), 8) || 0;
    const type = String.fromCharCode(data[offset + 156]);
    const prefix = readString(data, offset + 345, 155);
    const name = readString(data, offset, 100);
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'L') {
      pending = type === 'x' ? paxPath(body) : readString(body, 0, size);
      continue;
    }
    const entry = pending || (prefix ? `${prefix}/${name}` : name);
    pending = null;
    writeEntry(dest, entry, type, body);
  }
};

/** Every file below `dir`, as sorted POSIX-style relative paths. */
export const listFiles = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(dir, path.join(entry.parentPath ?? entry.path, entry.name))
        .split(path.sep)
        .join('/')
    )
    .sort();

let packed;

/**
 * `npm pack` the js/ package once per process and unpack it; resolves with
 * the directory holding the unpacked `package/` tree.
 */
export const packArtifact = () =>
  (packed ??= (async () => {
    const dir = tempdir('cs-zx-pack-');
    await runOk(
      'npm',
      ['pack', '--ignore-scripts', '--silent', '--pack-destination', dir],
      { cwd: ROOT }
    );
    const tarball = fs.readdirSync(dir).find((file) => file.endsWith('.tgz'));
    untar(path.join(dir, tarball), dir);
    return path.join(dir, 'package');
  })());

/**
 * Stage a consumer project whose `node_modules/command-stream` holds `files`
 * (default: all) of the unpacked package. The zx layer has no third-party
 * dependencies, so a plain copy stands in for `npm install`.
 */
export const makeProject = async ({ files, pkgJson = {} } = {}) => {
  const pkgDir = await packArtifact();
  const project = tempdir();
  const installed = path.join(project, 'node_modules', 'command-stream');
  if (files) {
    for (const file of ['package.json', ...files]) {
      fs.mkdirSync(path.dirname(path.join(installed, file)), {
        recursive: true,
      });
      fs.copyFileSync(path.join(pkgDir, file), path.join(installed, file));
    }
  } else {
    fs.cpSync(pkgDir, installed, { recursive: true });
  }
  writeFiles(project, {
    'package.json': JSON.stringify({ private: true, ...pkgJson }, null, 2),
  });
  return project;
};

/** Link a dev dependency of js/ (e.g. `@types`) into a staged project. */
export const linkDevModule = (project, name) =>
  fs.symlinkSync(
    path.join(ROOT, 'node_modules', name),
    path.join(project, 'node_modules', name),
    'junction'
  );

export const writeFiles = (dir, files) => {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
};
