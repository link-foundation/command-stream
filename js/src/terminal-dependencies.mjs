import { createRequire } from 'node:module';

const missingDependency = (name, feature, cause) =>
  new Error(`${feature} requires ${name}. Run npm install ${name}.`, { cause });

export async function importTerminalDependency(name, feature, load) {
  try {
    return await load();
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

export function requireHeadlessTerminal() {
  // TerminalBuffer is synchronous. Resolve its peer only when constructed.
  const require = createRequire(import.meta.url);
  let entry;
  try {
    entry = require.resolve('@xterm/headless');
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      throw missingDependency('@xterm/headless', 'TerminalBuffer', error);
    }
    throw error;
  }
  return require(entry).Terminal;
}
