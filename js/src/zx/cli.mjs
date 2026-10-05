#!/usr/bin/env node
// `command-stream` executable: a drop-in for the `zx` CLI (issue #26).
//
//   command-stream script.mjs|script.md|https://... [args]
//   command-stream --eval 'await $`ls`'
//   echo 'await $`pwd`' | command-stream
//
// Scripts may start with `#!/usr/bin/env command-stream`; the zx globals
// (`$`, `cd`, `fs`, `glob`, `echo`, ...) are available without imports.

import process from 'node:process';
import url from 'node:url';
import { installDeps, parseDeps } from './deps.mjs';
import {
  $,
  chalk,
  dotenv,
  Fail,
  fetch,
  fs,
  parseArgv,
  path,
  ProcessOutput,
  resolveDefaults,
  stdin,
  updateArgv,
  VERSION,
} from './index.mjs';
import { transformMarkdown } from './md.mjs';
import { startRepl } from './repl.mjs';
import { randomId } from './util.mjs';
import { createRequire } from './vendor.mjs';

export { transformMarkdown } from './md.mjs';

const EXT = '.mjs';
const EXT_RE = /^\.[mc]?[jt]sx?$/;

export const argv = parseArgv(process.argv.slice(2), {
  default: resolveDefaults(
    { 'prefer-local': false },
    'ZX_',
    process.env,
    new Set(['env', 'install', 'registry'])
  ),
  string: [
    'shell',
    'prefix',
    'postfix',
    'eval',
    'cwd',
    'ext',
    'registry',
    'env',
  ],
  boolean: [
    'version',
    'help',
    'quiet',
    'verbose',
    'install',
    'repl',
    'experimental',
  ],
  alias: {
    e: 'eval',
    i: 'install',
    v: 'version',
    h: 'help',
    l: 'prefer-local',
    'env-file': 'env',
  },
  stopEarly: true,
  parseBoolean: true,
  camelCase: true,
});

/**
 * Run `main()` when `meta` belongs to the entry module.
 *
 * @param {ImportMeta} meta `import.meta` of the caller.
 */
export function autorun(meta) {
  if (!meta || !isMain(meta)) {
    return;
  }
  main().catch((err) => {
    if (err instanceof ProcessOutput) {
      console.error('Error:', err.message);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });
}

// The package's own version; VERSION is the zx release this layer mirrors.
const PKG_VERSION = createRequire(import.meta.url)(
  '../../package.json'
).version;

export function printUsage() {
  console.log(`
 ${chalk.bold(`command-stream ${PKG_VERSION}`)} (zx ${VERSION} compatible)
   A tool for writing better scripts

 ${chalk.bold('Usage')}
   command-stream [options] <script>

 ${chalk.bold('Options')}
   --quiet              suppress any outputs
   --verbose            enable verbose mode
   --shell=<path>       custom shell binary
   --prefix=<command>   prefix all commands
   --postfix=<command>  postfix all commands
   --prefer-local, -l   prefer locally installed packages and binaries
   --cwd=<path>         set current directory
   --eval=<js>, -e      evaluate script
   --ext=<.mjs>         script extension
   --install, -i        install dependencies
   --registry=<URL>     npm registry, defaults to https://registry.npmjs.org/
   --version, -v        print current zx-compatible version
   --help, -h           print help
   --repl               start repl
   --env=<path>         path to env file
   --experimental       enables experimental features (deprecated)

 ${chalk.italic('Full documentation:')} ${chalk.underline(Fail.DOCS_URL)}
`);
}

const OPTION_SETTERS = {
  verbose: () => ($.verbose = true),
  quiet: () => ($.quiet = true),
  shell: (v) => ($.shell = v),
  prefix: (v) => ($.prefix = v),
  postfix: (v) => ($.postfix = v),
  preferLocal: (v) => ($.preferLocal = v),
};

function applyOptions() {
  if (argv.cwd) {
    $.cwd = argv.cwd;
  }
  if (argv.env) {
    dotenv.config(path.resolve($.cwd ?? process.cwd(), argv.env));
    resolveDefaults();
  }
  for (const [name, set] of Object.entries(OPTION_SETTERS)) {
    if (argv[name]) {
      set(argv[name]);
    }
  }
}

export async function main() {
  if (argv.version) {
    console.log(VERSION);
    return;
  }
  if (argv.help) {
    printUsage();
    return;
  }
  applyOptions();
  await import('./globals.mjs');
  if (argv.repl) {
    await startRepl();
    return;
  }
  argv.ext = normalizeExt(argv.ext);
  const { script, scriptPath, tempPath } = await readScript();
  await runScript(script, scriptPath, tempPath);
}

function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch (_err) {
    return undefined;
  }
}

const rmrf = (p) => {
  if (!p) {
    return;
  }
  if (lstat(p)?.isSymbolicLink()) {
    fs.unlinkSync(p);
  } else {
    fs.rmSync(p, { force: true, recursive: true });
  }
};

async function runScript(script, scriptPath, tempPath) {
  let nmLink = '';
  const rmTemp = () => {
    rmrf(tempPath);
    rmrf(nmLink);
  };
  try {
    const target = tempPath || scriptPath;
    if (tempPath) {
      await fs.writeFile(tempPath, script);
    }
    const cwd = path.dirname(target);
    if (typeof argv.preferLocal === 'string') {
      nmLink = linkNodeModules(cwd, argv.preferLocal);
    }
    if (argv.install) {
      await installDeps(parseDeps(script), cwd, argv.registry);
    }
    injectGlobalRequire(target);
    process.once('exit', rmTemp);
    await import(url.pathToFileURL(target).toString());
  } finally {
    rmTemp();
  }
}

function linkNodeModules(cwd, external) {
  const nm = 'node_modules';
  const alias = path.resolve(cwd, nm);
  const target =
    path.basename(external) === nm
      ? path.resolve(external)
      : path.resolve(external, nm);
  const aliasStat = lstat(alias);
  if (!lstat(target)?.isDirectory()) {
    throw new Fail(
      `Can't link node_modules: ${target} doesn't exist or is not a directory`
    );
  }
  if (aliasStat?.isDirectory() && alias !== target) {
    throw new Fail(`Can't link node_modules: ${alias} already exists`);
  }
  if (aliasStat) {
    return '';
  }
  fs.symlinkSync(target, alias, 'junction');
  return alias;
}

const readScriptFromStdin = () =>
  process.stdin.isTTY ? Promise.resolve('') : stdin();

async function readScriptFromHttp(remote) {
  const res = await fetch(remote);
  if (!res.ok) {
    console.error(`Error: Can't get ${remote}`);
    process.exitCode = 1;
    // An unread native fetch body holds the socket and keeps Node alive.
    await res.body?.cancel();
    throw new Fail(`Failed to fetch remote script: ${remote} (${res.status})`);
  }
  return res.text();
}

async function loadSource(firstArg) {
  if (argv.eval) {
    return { script: argv.eval, tempPath: getFilepath($.cwd), argSlice: 0 };
  }
  if (!firstArg || firstArg === '-') {
    const script = await readScriptFromStdin();
    if (script.length === 0) {
      printUsage();
      process.exitCode = 1;
      throw new Fail('No script provided');
    }
    return { script, tempPath: getFilepath($.cwd), argSlice: 1 };
  }
  if (/^https?:/.test(firstArg)) {
    const { name, ext = argv.ext } = path.parse(new URL(firstArg).pathname);
    const script = await readScriptFromHttp(firstArg);
    return { script, tempPath: getFilepath($.cwd, name, ext), argSlice: 1 };
  }
  const script = await fs.readFile(firstArg, 'utf8');
  const scriptPath = firstArg.startsWith('file:')
    ? url.fileURLToPath(firstArg)
    : path.resolve(firstArg);
  return { script, scriptPath, tempPath: '', argSlice: 1 };
}

async function readScript() {
  const source = await loadSource(argv._[0]);
  let { script, tempPath } = source;
  const scriptPath = source.scriptPath || '';
  const { ext, base, dir } = path.parse(tempPath || scriptPath);
  if (ext === '' || (argv.ext && !EXT_RE.test(ext))) {
    tempPath = getFilepath(dir, base);
  }
  if (ext === '.md') {
    script = transformMarkdown(script);
    tempPath = getFilepath(dir, base, EXT);
  }
  if (source.argSlice) {
    updateArgv(argv._.slice(source.argSlice));
  }
  return { script, scriptPath, tempPath };
}

/**
 * Expose CommonJS-style `require`, `__filename` and `__dirname` globals for
 * the script at `origin`.
 *
 * @param {string} origin Script path.
 */
export function injectGlobalRequire(origin) {
  const __filename = path.resolve(origin);
  const __dirname = path.dirname(__filename);
  const require = createRequire(origin);
  Object.assign(globalThis, { __filename, __dirname, require });
}

/**
 * Whether `meta` (an `import.meta` or its `url`) is the entry module.
 *
 * @param {ImportMeta|string} meta Module meta or URL.
 * @param {string} scriptpath Entry script path.
 * @returns {boolean}
 */
export function isMain(meta = import.meta.url, scriptpath = process.argv[1]) {
  if (typeof meta !== 'string') {
    // Node < 24 has no `import.meta.main`: compare the module URL instead.
    return typeof meta.main === 'boolean'
      ? meta.main
      : isMain(meta.url, scriptpath);
  }
  if (!meta.startsWith('file:') || !scriptpath) {
    return false;
  }
  const modulePath = url.fileURLToPath(meta).replace(/\.\w+$/, '');
  const mainPath = fs.realpathSync(scriptpath).replace(/\.\w+$/, '');
  return mainPath === modulePath;
}

export function normalizeExt(ext) {
  return ext ? path.parse(`foo.${ext}`).ext : ext;
}

function getFilepath(cwd = '.', name = 'zx', customExt = '') {
  const ext = customExt || argv.ext || EXT;
  return [`${name}${ext}`, `${name}-${randomId()}${ext}`]
    .map((f) => path.resolve(process.cwd(), cwd, f))
    .find((f) => !fs.existsSync(f));
}

autorun(import.meta);
