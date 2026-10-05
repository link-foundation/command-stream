/**
 * TypeScript declarations for `command-stream/zx/globals` (ES module and
 * CommonJS entry point).
 *
 * Importing (or requiring) the module copies every export of
 * `command-stream/zx` onto `globalThis`; the module itself exports nothing.
 * `fetch` is copied too, but it is not redeclared here because it would clash
 * with the built-in global `fetch` declared by `@types/node` (zx omits it for
 * the same reason): the global keeps its standard type.
 */

import type * as zx from './zx-api.cjs';

declare global {
  type ProcessPromise = zx.ProcessPromise;
  type ProcessOutput = zx.ProcessOutput;
  type Fail = zx.Fail;
  var ProcessPromise: typeof zx.ProcessPromise;
  var ProcessOutput: typeof zx.ProcessOutput;
  var Fail: typeof zx.Fail;
  var $: typeof zx.$;
  var MAML: typeof zx.MAML;
  var VERSION: typeof zx.VERSION;
  var YAML: typeof zx.YAML;
  var argv: typeof zx.argv;
  var bus: typeof zx.bus;
  var cd: typeof zx.cd;
  var chalk: typeof zx.chalk;
  var defaults: typeof zx.defaults;
  var dotenv: typeof zx.dotenv;
  var echo: typeof zx.echo;
  var expBackoff: typeof zx.expBackoff;
  var fs: typeof zx.fs;
  var glob: typeof zx.glob;
  var globby: typeof zx.globby;
  var kill: typeof zx.kill;
  var log: typeof zx.log;
  var minimist: typeof zx.minimist;
  var nothrow: typeof zx.nothrow;
  var os: typeof zx.os;
  var parseArgv: typeof zx.parseArgv;
  var path: typeof zx.path;
  var ps: typeof zx.ps;
  var question: typeof zx.question;
  var quiet: typeof zx.quiet;
  var quote: typeof zx.quote;
  var quotePowerShell: typeof zx.quotePowerShell;
  var resolveDefaults: typeof zx.resolveDefaults;
  var retry: typeof zx.retry;
  var sleep: typeof zx.sleep;
  var spinner: typeof zx.spinner;
  var stdin: typeof zx.stdin;
  var syncProcessCwd: typeof zx.syncProcessCwd;
  var tempdir: typeof zx.tempdir;
  var tempfile: typeof zx.tempfile;
  var tmpdir: typeof zx.tmpdir;
  var tmpfile: typeof zx.tmpfile;
  var updateArgv: typeof zx.updateArgv;
  var useBash: typeof zx.useBash;
  var usePowerShell: typeof zx.usePowerShell;
  var usePwsh: typeof zx.usePwsh;
  var version: typeof zx.version;
  var versions: typeof zx.versions;
  var which: typeof zx.which;
  var within: typeof zx.within;
}

export {};
