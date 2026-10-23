import { createRequire } from 'node:module';
import {
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  join,
} from 'node:path';
import { readFile, realpath, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execa } from './execa/index.mjs';
import { virtualCommands } from './$.state.mjs';
import { trace } from './$.trace.mjs';

export const commandMetadata = new Map();
const packages = new Map();
let revision = 0;

async function loadPackage(file, reload) {
  if (!reload) {
    return import(pathToFileURL(file).href);
  }
  // Bun canonicalizes query strings on local modules. A fresh sibling file
  // also preserves relative imports, unlike a data URL or a system temp file.
  const fresh = join(
    dirname(file),
    `.command-stream-${basename(file)}-${randomUUID()}${extname(file)}`
  );
  await writeFile(fresh, await readFile(file), { flag: 'wx' });
  try {
    return await import(`${pathToFileURL(fresh).href}?revision=${++revision}`);
  } finally {
    await unlink(fresh);
  }
}

function validate(name, handler) {
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z_][\w:.-]*$/.test(name) ||
    typeof handler !== 'function'
  ) {
    throw new TypeError(`Invalid virtual command: ${name}`);
  }
}

export function createCommand(name, handler, metadata = {}) {
  validate(name, handler);
  virtualCommands.set(name, handler);
  commandMetadata.set(name, { name, ...metadata });
  return handler;
}

export function extend(name, middleware) {
  const parent = virtualCommands.get(name);
  if (!parent) {
    throw new Error(`Virtual command not found: ${name}`);
  }
  if (typeof middleware !== 'function') {
    throw new TypeError('Middleware must be a function');
  }
  const handler = (context) =>
    middleware(context, (nextContext = context) => parent(nextContext));
  virtualCommands.set(name, handler);
  return handler;
}

export function inherit(name, parent, defaults = {}) {
  const handler = virtualCommands.get(parent);
  if (!handler) {
    throw new Error(`Virtual command not found: ${parent}`);
  }
  return createCommand(
    name,
    (context) =>
      handler({
        ...context,
        ...defaults,
        args: [...(defaults.args ?? []), ...context.args],
      }),
    { parent }
  );
}

async function collectResult(value) {
  value = await value;
  if (value?.[Symbol.asyncIterator] || value?.[Symbol.iterator]) {
    const chunks = [];
    for await (const chunk of value) {
      chunks.push(Buffer.from(chunk));
    }
    return { code: 0, stdout: Buffer.concat(chunks).toString() };
  }
  return { code: 0, stdout: '', ...value };
}

export function compose(...handlers) {
  if (
    !handlers.length ||
    handlers.some((handler) => typeof handler !== 'function')
  ) {
    throw new TypeError('Composition requires command handlers');
  }
  return async (context) => {
    let result = { code: 0, stdout: context.stdin ?? '' };
    for (const handler of handlers) {
      result = await collectResult(
        handler({ ...context, stdin: result.stdout })
      );
      if (result.code !== 0) {
        break;
      }
    }
    return result;
  };
}

async function resolvePackage(specifier, { cwd, install }) {
  const require = createRequire(resolve(cwd, 'package.json'));
  const target =
    isAbsolute(specifier) || specifier.startsWith('.')
      ? resolve(cwd, specifier)
      : specifier;
  try {
    return require.resolve(target);
  } catch (error) {
    if (
      !install ||
      !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[^\s]+)?$/i.test(specifier)
    ) {
      throw error;
    }
    const result = await execa(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--',
        specifier,
      ],
      { cwd, reject: false }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Package installation failed: ${result.stderr}`, {
        cause: error,
      });
    }
    return require.resolve(specifier.replace(/@[^@/]+$/, ''));
  }
}

export async function install(
  specifier,
  { cwd = process.cwd(), install = true, replace = false, reload = false } = {}
) {
  if (typeof specifier !== 'string' || !specifier) {
    throw new TypeError('Expected a package name or module path');
  }
  // Keep one identity for linked packages even with --preserve-symlinks.
  const file = await realpath(
    await resolvePackage(specifier, { cwd, install })
  );
  const current = packages.get(file);
  if (current && !reload) {
    return current;
  }
  const module = await loadPackage(file, reload);
  const definition = module.default ?? module;
  const entries = validatePackage(definition, current, replace);
  const installed = registerPackage({
    file,
    current,
    definition,
    entries,
    specifier,
    cwd,
    replace,
  });
  packages.set(file, installed);
  trace(
    'CommandPackages',
    () =>
      `Installed ${installed.name}: ${entries.map(([name]) => name).join(', ')}`
  );
  return installed;
}
const installPackage = install;

export const marketplace = {
  async search(
    query,
    {
      registry = 'https://registry.npmjs.org',
      fetch: request = globalThis.fetch,
      size = 20,
      signal,
    } = {}
  ) {
    const url = new URL('/-/v1/search', registry);
    url.searchParams.set('text', `keywords:command-stream-command ${query}`);
    url.searchParams.set('size', String(Math.min(250, Math.max(1, size))));
    const response = await request(url.href, { signal });
    if (!response.ok) {
      throw new Error(`Marketplace search failed: ${response.status}`);
    }
    const result = await response.json();
    return result.objects.map(({ package: metadata }) => metadata);
  },
};

function validatePackage(definition, current, replace) {
  const entries = Object.entries(definition.commands ?? {});
  if (!entries.length) {
    throw new TypeError(
      'Command package must export a nonempty commands object'
    );
  }
  for (const [name, handler] of entries) {
    validate(name, handler);
    if (
      virtualCommands.has(name) &&
      current?.handlers.get(name) !== virtualCommands.get(name) &&
      !replace
    ) {
      throw new Error(`Command already registered: ${name}`);
    }
  }
  return entries;
}
function registerPackage({
  file,
  current,
  definition,
  entries,
  specifier,
  cwd,
  replace,
}) {
  // Validate everything before mutating the registry, including on reload.
  const previous = new Map(current?.previous ?? []);
  const previousMetadata = new Map(current?.previousMetadata ?? []);
  const uninstall = () => {
    for (const [name, handler] of installed.handlers) {
      if (virtualCommands.get(name) !== handler) {
        continue;
      }
      if (previous.has(name)) {
        virtualCommands.set(name, previous.get(name));
      } else {
        virtualCommands.delete(name);
      }
      if (previousMetadata.has(name)) {
        commandMetadata.set(name, previousMetadata.get(name));
      } else {
        commandMetadata.delete(name);
      }
    }
    if (packages.get(file) === installed) {
      packages.delete(file);
    }
  };
  current?.uninstall();
  const installed = current ?? {};
  Object.assign(installed, {
    name: definition.name ?? specifier,
    version: definition.version ?? '0.0.0',
    file,
    handlers: new Map(entries),
    previous,
    previousMetadata,
    uninstall,
    reload: () => installPackage(file, { cwd, replace, reload: true }),
  });
  for (const [name, handler] of entries) {
    if (virtualCommands.has(name) && !previous.has(name)) {
      previous.set(name, virtualCommands.get(name));
      if (commandMetadata.has(name)) {
        previousMetadata.set(name, commandMetadata.get(name));
      }
    }
    createCommand(name, handler, {
      package: installed.name,
      description: definition.descriptions?.[name],
    });
  }
  return installed;
}
