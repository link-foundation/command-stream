// Bus-wrapped helper libraries re-exported by the zx-compatible API (issue #26).
//
// Every helper is an original, dependency-free implementation living in
// `./vendor/`; wrapping them through `bus` lets callers swap an implementation
// (for example a real `fs-extra`) before the public index locks the bus.

import { createRequire as nodeCreateRequire } from 'node:module';
import { bus } from './internals.mjs';
import _depseek from './vendor/depseek.mjs';
import _dotenv from './vendor/dotenv.mjs';
import _fs from './vendor/fs.mjs';
import _glob from './vendor/glob.mjs';
import _maml from './vendor/maml.mjs';
import _minimist from './vendor/minimist.mjs';
import * as _yaml from './vendor/yaml.mjs';

export * from './vendor-core.mjs';

const { wrap } = bus;

export const createRequire = nodeCreateRequire;

export const depseek = wrap('depseek', _depseek.depseekSync);
export const dotenv = wrap('dotenv', _dotenv);
export const fs = wrap('fs', _fs);
export const YAML = wrap('YAML', _yaml);
export const MAML = wrap('MAML', _maml);
export const glob = wrap('glob', _glob);
// Captured before `globals.mjs` replaces `globalThis.fetch` with the zx
// `fetch`, which itself delegates here.
const nativeFetch = globalThis.fetch;
export const nodeFetch = wrap('nodeFetch', (...args) => nativeFetch(...args));
export const minimist = wrap('minimist', _minimist);
