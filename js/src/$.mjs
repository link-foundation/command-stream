// Full command-stream API. Shell execution and virtual commands are shared
// with command-stream/core; optional feature layers are initialized here.
import shelljs from './shelljs/index.mjs';
import * as publicApi from './$.mjs';
import { $ as $tagged } from './core.mjs';
import { trace } from './$.trace.mjs';
import { createRequire } from 'node:module';
import { TerminalBuffer } from './terminal-buffer.mjs';
import {
  captureTerminal,
  openTerminal,
  readAsciicast,
  unrollTerminalFrames,
} from './terminal-capture.mjs';
import {
  startRepl as createRepl,
  dev as createDev,
  PipelineDebugger,
} from './development.mjs';
import { install, marketplace } from './command-packages.mjs';
import { testing } from './testing.mjs';
import { startRustRepl } from './rust-repl.mjs';
import { $ as bunShell } from './bun-shell/shell.mjs';

$tagged.TerminalBuffer = TerminalBuffer;
Object.assign($tagged, { install, marketplace });
// Read the namespace when a session starts, after module initialization, so
// every current and future public export is available in the REPL.
const startRepl = (options) => createRepl(publicApi, options);
const dev = (options) => createDev(publicApi, options);
Object.assign($tagged, {
  dev,
  startRepl,
  startRustRepl,
  PipelineDebugger,
  testing,
});
Object.defineProperty($tagged, 'shelljs', { get: () => shelljs });
// `$.bun`: the Bun.$-compatible shell (also `command-stream/bun`).
$tagged.bun = bunShell;

// `$.zx` is the zx compatibility mode (issue #26): the `$` of
// `command-stream/zx`. It is loaded on first access through `require(esm)`,
// like `$.cjs`, so `command-stream` users who never touch it do not pay for
// the zx layer.
let compatibilityRequire;
function requireCompat(specifier) {
  // HTTP module URLs are not valid createRequire bases. Core CDN imports do
  // not need this filesystem-backed loader; initialize it only on use.
  compatibilityRequire ??= createRequire(import.meta.url);
  return compatibilityRequire(specifier);
}
Object.defineProperty($tagged, 'zx', {
  configurable: true,
  enumerable: false,
  get: () => requireCompat('./zx/core.cjs').$,
});

// The isolated Execa entry is loaded only when this compatibility API is used.
function execaCompat(options) {
  trace('ExecaCompat', () => 'Loading the isolated Execa API');
  return requireCompat('./execa/index.cjs').execaCompat(options);
}

const execa = (...args) => execaCompat().execa(...args);
const execaSync = (...args) => execaCompat().execaSync(...args);
const execaNode = (...args) => execaCompat().execaNode(...args);
const execaCommand = (...args) => execaCompat().execaCommand(...args);
const execaCommandSync = (...args) => execaCompat().execaCommandSync(...args);

Object.defineProperties($tagged, {
  execa: { configurable: true, get: () => execaCompat().execa },
  execaCompat: { configurable: true, value: execaCompat },
});

export * from './core.mjs';
export {
  install,
  marketplace,
  startRustRepl,
  dev,
  startRepl,
  PipelineDebugger,
  testing,
  TerminalBuffer,
  shelljs,
  execaCompat,
  execa,
  execaSync,
  execaNode,
  execaCommand,
  execaCommandSync,
  captureTerminal,
  openTerminal,
  readAsciicast,
  unrollTerminalFrames,
};
export default $tagged;
