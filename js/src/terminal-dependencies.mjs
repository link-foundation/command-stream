import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';

const missingDependency = (name, feature, cause) =>
  new Error(`${feature} requires ${name}. Run npm install ${name}.`, { cause });

const isRemoteModule = /^https?:/.test(import.meta.url);

export async function importTerminalDependency(name, feature) {
  if (isRemoteModule) {
    return requireTerminalDependency(name, feature);
  }
  try {
    // A computed specifier keeps HTTP tooling from prefetching optional peers.
    return await import(name);
  } catch (error) {
    // A loader can also fail because a dependency of the peer is missing.
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' &&
      error.message.startsWith(`Cannot find package '${name}'`)
    ) {
      throw missingDependency(name, feature, error);
    }
    throw error;
  }
}

function requireTerminalDependency(name, feature) {
  // HTTP entry points resolve installed peers from the caller's project.
  const require = createRequire(
    isRemoteModule ? resolve(process.cwd(), 'package.json') : import.meta.url
  );
  let entry;
  try {
    entry = require.resolve(name);
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      throw missingDependency(name, feature, error);
    }
    throw error;
  }
  return require(entry);
}

export function requireHeadlessTerminal() {
  return requireTerminalDependency('@xterm/headless', 'TerminalBuffer')
    .Terminal;
}
