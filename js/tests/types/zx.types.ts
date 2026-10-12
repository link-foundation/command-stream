/**
 * Compile-only tests for `command-stream/zx` (`types/zx.d.ts`).
 */

import { Writable } from 'node:stream';
import {
  $,
  Fail,
  MAML,
  ProcessOutput,
  ProcessPromise,
  VERSION,
  YAML,
  argv,
  bus,
  cd,
  chalk,
  defaults,
  dotenv,
  echo,
  expBackoff,
  fetch,
  fs,
  glob,
  globby,
  kill,
  log,
  minimist,
  nothrow,
  os,
  parseArgv,
  path,
  ps,
  question,
  quiet,
  quote,
  quotePowerShell,
  resolveDefaults,
  retry,
  sleep,
  spinner,
  stdin,
  syncProcessCwd,
  tempdir,
  tempfile,
  tmpdir,
  tmpfile,
  updateArgv,
  useBash,
  usePowerShell,
  usePwsh,
  version,
  versions,
  which,
  within,
  type Duration,
  type GlobEntry,
  type LogEntry,
  type Options,
  type ProcessStage,
  type PsLookupEntry,
  type Shell,
} from 'command-stream/zx';
import { expectType, use, type Equal } from './helpers.cjs';

export async function shell(): Promise<void> {
  const p = $`echo ${'hi'} ${['a', 'b']}`;
  expectType<Equal<typeof p, ProcessPromise>>();
  const out = await p;
  expectType<Equal<typeof out, ProcessOutput>>();
  expectType<Equal<typeof out.stdout, string>>();
  expectType<Equal<typeof out.exitCode, number | null>>();
  expectType<Equal<ReturnType<typeof out.lines>, string[]>>();
  const json: { a: number } = out.json<{ a: number }>();
  const ok: boolean = out.ok;

  // Options binders keep the flavour: `sync: true` switches to ProcessOutput.
  const bound = $({ cwd: '/tmp', nothrow: true, timeout: '5s' });
  expectType<Equal<typeof bound, Shell>>();
  const syncShell = $({ sync: true });
  expectType<Equal<typeof syncShell, Shell<true>>>();
  const syncShellOut = syncShell`echo hi`;
  expectType<Equal<typeof syncShellOut, ProcessOutput>>();
  const syncOut = $.sync`echo hi`;
  expectType<Equal<typeof syncOut, ProcessOutput>>();

  // `$` is also the options store.
  $.verbose = true;
  $.shell = '/bin/bash';
  $.prefix = 'set -euo pipefail;';
  const verbose: boolean = $.verbose;
  const opts: Partial<Options> = { quiet: true, preferLocal: ['/opt/bin'] };

  // ProcessPromise chain.
  const chained = $`sleep 1`.nothrow().quiet().timeout(100).stdio('pipe');
  expectType<Equal<typeof chained, ProcessPromise>>();
  const text: string = await p.text();
  const lines: string[] = await p.lines();
  const exitCode: number | null = await p.exitCode;
  const stage: ProcessStage = p.stage;
  const piped = $`echo 1`.pipe`cat`;
  expectType<Equal<typeof piped, ProcessPromise>>();
  const toStream = $`echo 1`.pipe(new Writable());
  const streamed = await toStream;
  expectType<Equal<typeof streamed, ProcessOutput & Writable>>();
  const toProcess = $`echo 1`.pipe.stderr($`cat`);
  expectType<Equal<typeof toProcess, ProcessPromise>>();
  for await (const line of $`ls`) {
    expectType<Equal<typeof line, string>>();
  }
  const handled = await $`exit 1`.catch((e) => e.exitCode);
  expectType<Equal<typeof handled, ProcessOutput | number | null>>();
  await p.kill('SIGTERM');

  // @ts-expect-error - internals are private, as in zx
  p.build();
  // @ts-expect-error - options are type checked
  $({ verbose: 'yes' });
  // @ts-expect-error - not a duration
  $`true`.timeout('5 hours');

  const fromError: ProcessOutput = ProcessOutput.fromError(new Error('x'));
  const failure = new ProcessOutput(1, null, '', 'boom', 'boom', 'failed');
  const isError: Error = failure;
  const docs: string = Fail.DOCS_URL;
  const message: string = Fail.formatExitMessage(1, null, '', '');

  use(json, ok, verbose, opts, text, lines, exitCode, stage);
  use(fromError, isError, docs, message);
}

export async function helpers(): Promise<void> {
  cd('/tmp');
  within(() => {
    $.cwd = '/';
  });
  const nested: number = within(() => 1);
  syncProcessCwd();
  useBash();
  usePwsh();
  usePowerShell();
  await kill(123, 'SIGKILL');
  const quoted: string = quote('a b') + quotePowerShell('a b');
  const resolved: Options = resolveDefaults();
  const custom = resolveDefaults({ foo: 1 }, 'APP_', process.env);
  expectType<Equal<typeof custom, { foo: number }>>();
  const cwd: string | undefined = defaults.cwd;
  const entry: LogEntry = { kind: 'cmd', cmd: 'ls', cwd: '/', id: '1' };
  log(entry);
  log({ kind: 'custom', data: 1, verbose: true });
  log.formatters = { cmd: ({ cmd }) => cmd };
  // @ts-expect-error - unknown log kind
  log({ kind: 'nope' });

  await sleep(100);
  await sleep('1s');
  const duration: Duration = '100ms';
  echo`hi ${1}`;
  echo('a', 'b');
  const answer: string = await question('name? ', { choices: ['a'] });
  const input: string = await stdin();
  const retried: number = await retry(3, () => 1);
  const backoff: number = await retry(3, expBackoff(), async () => 2);
  const withDelay: string = await retry(3, '1s', () => 'x');
  const spun: number = await spinner('working', async () => 1);
  const spunNoTitle: number = await spinner(() => 1);
  const response: Response = await fetch('https://example.com');
  const fetchPiped = fetch('https://example.com').pipe`cat`;
  expectType<Equal<typeof fetchPiped, ProcessPromise>>();
  const dir: string = tempdir() + tmpdir('x') + tempfile('a.txt', 'data');
  expectType<Equal<typeof tmpfile, typeof tempfile>>();
  const noThrow: ProcessPromise = nothrow($`false`);
  const silent: ProcessPromise = quiet($`true`);
  const v: string = VERSION + version + versions.zx + versions.yaml;
  // @ts-expect-error - maml is not listed in versions
  use(versions.maml);

  const parsed = parseArgv(['--foo-bar', '1'], { camelCase: true });
  const positional: Array<string | number> = parsed._;
  updateArgv(['--x'], { boolean: ['x'] });
  const flag: unknown = argv['verbose'];
  const mini = minimist(['-n', '3', 'x'], { string: ['s'], '--': true });
  const minimistOpts: minimist.Opts = { alias: { h: 'help' } };

  const env: Record<string, string> = dotenv.parse('A=1');
  const envText: string = dotenv.stringify({ A: '1' });
  const loaded = dotenv.config('.env');
  const merged = dotenv.loadSafe('.env', '.env.local');

  const joined: string = path.join('a', 'b');
  const home: string = os.homedir();

  const locked: ProcessPromise = bus.wrap('x', $`true`);
  bus.override('chalk', {});

  use(nested, quoted, resolved, cwd, duration, answer, input);
  use(retried, backoff, withDelay, spun, spunNoTitle, response, dir);
  use(noThrow, silent, v, positional, flag, mini, minimistOpts);
  use(env, envText, loaded, merged, joined, home, locked);
}

export async function vendor(): Promise<void> {
  // chalk: chainable styles and color functions.
  const styled: string =
    chalk.bold.red.bgBlueBright('x') + chalk.hex('#fff')`y`;
  const rgb: string = chalk.rgb(1, 2, 3).underline('z');
  chalk.level = 0;
  // @ts-expect-error - unknown style
  chalk.sparkly('x');

  // which: result type follows `all` / `nothrow`.
  expectType<Equal<Awaited<ReturnType<typeof which<{}>>>, string>>();
  const all = await which('node', { all: true });
  expectType<Equal<typeof all, string[]>>();
  const maybe = await which('nope', { nothrow: true });
  expectType<Equal<typeof maybe, string | null>>();
  const syncAll = which.sync('node', { all: true, nothrow: true });
  expectType<Equal<typeof syncAll, string[] | null>>();

  // ps
  const list: PsLookupEntry[] = await ps.lookup({ command: 'node' });
  const children = await ps.tree({ pid: 1, recursive: true });
  const syncTree: PsLookupEntry[] = ps.tree.sync(1);
  const killed: string = await ps.kill(123, 'SIGTERM');
  const lookedUp: PsLookupEntry[] = ps.lookupSync();

  // fs: node:fs plus promise forms and fs-extra helpers.
  const content: string = await fs.readFile('a.txt', 'utf8');
  const bytes: Buffer = await fs.readFile('a.txt');
  const syncContent: string = fs.readFileSync('a.txt', 'utf8');
  fs.readFile('a.txt', (err, data) => use(err, data));
  const fd: number = await fs.open('a.txt', 'r');
  const exists: boolean = await fs.pathExists('a.txt');
  const oldExists: boolean = await fs.exists('a.txt');
  const pkg = await fs.readJson<{ name: string }>('package.json');
  expectType<Equal<typeof pkg, { name: string }>>();
  await fs.outputJson('out.json', { a: 1 }, { spaces: 2 });
  await fs.copy('a', 'b', { overwrite: true, filter: () => true });
  fs.copySync('a', 'b', (src) => src.length > 0);
  await fs.ensureDir('dir', 0o755);
  await fs.move('a', 'b', { overwrite: true });
  await fs.remove('b');
  fs.emptyDirSync('dir');
  const files: string[] = await fs.glob('*.js');
  const stat = await fs.stat('a');
  const isFile: boolean = stat.isFile();
  // @ts-expect-error - not a fs function
  fs.notAFunction();

  // glob (globby)
  const paths: string[] = await glob(['*.js', '!x.js'], { dot: true });
  const entries: GlobEntry[] = await globby('*', { objectMode: true });
  const syncPaths: string[] = glob.sync('*');
  const dynamic: boolean = glob.isDynamicPattern('*.js');
  const ignored: (p: string) => boolean = glob.isGitIgnoredSync();
  const re: RegExp = glob.globToRegExp('*.js');

  // YAML and MAML
  const data: unknown = YAML.parse('a: 1');
  const yamlText: string | undefined = YAML.stringify({ a: 1 }, null, 2);
  const doc = YAML.parseDocument('a: 1');
  const docErrors: YAML.YAMLError[] = doc.errors;
  const docText: string = doc.toString();
  const docs: YAML.Document[] = YAML.parseAllDocuments('a: 1\n---\nb: 2');
  const node = doc.createNode({ a: 1 });
  if (YAML.isMap(node)) {
    const has: boolean = node.has('a');
    use(has);
  }
  const scalar = new YAML.Scalar(1);
  expectType<Equal<typeof scalar.value, number>>();
  const plain: string = YAML.Scalar.PLAIN;
  YAML.visit(doc, (_key, _node) => YAML.visit.SKIP);
  const mamlData: unknown = MAML.parse('{ a: 1 }');
  const mamlText: string = MAML.stringify({ a: 1 });

  use(styled, rgb, list, children, syncTree, killed, lookedUp);
  use(content, bytes, syncContent, fd, exists, oldExists, files, isFile);
  use(paths, entries, syncPaths, dynamic, ignored, re);
  use(data, yamlText, docErrors, docText, docs, plain, mamlData, mamlText);
}
