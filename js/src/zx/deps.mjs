// Dependency detection and installation for `command-stream --install`
// (issue #26): scans a script for imports/requires and installs the missing
// packages, honoring `// @version` comments.

import { builtinModules } from 'node:module';
import { $, Fail, spinner } from './index.mjs';
import { depseek } from './vendor.mjs';

const installers = {
  async npm({ packages, prefix, registry }) {
    const flags = [
      '--no-save',
      '--no-audit',
      '--no-fund',
      prefix && `--prefix=${prefix}`,
      registry && `--registry=${registry}`,
    ].filter(Boolean);
    await $`npm install ${flags} ${packages}`.nothrow();
  },
};

/**
 * Install npm dependencies.
 *
 * @param {Record<string, string>} dependencies Name → version.
 * @param {string} prefix Install directory.
 * @param {string} registry Custom registry URL.
 * @param {string} installerType Package manager (only `npm` for now).
 */
export async function installDeps(
  dependencies,
  prefix,
  registry,
  installerType = 'npm'
) {
  const installer = installers[installerType];
  const packages = Object.entries(dependencies).map(
    ([name, version]) => `${name}@${version}`
  );
  if (packages.length === 0) {
    return;
  }
  if (!installer) {
    const supported = Object.keys(installers).join(', ');
    throw new Fail(
      `Unsupported installer type: ${installerType}. Supported types: ${supported}`
    );
  }
  await spinner(`${installerType} i ${packages.join(' ')}`, () =>
    installer({ packages, prefix, registry })
  );
}

const builtins = new Set(builtinModules);
const NAME_RE = /^(?<name>(@[a-z\d-~][\w-.~]*\/)?[a-z\d-~][\w-.~]*)\/?.*$/i;
const VERSION_RE = /^@(?<version>[~^]?(v?[\dx*]+([-.][\d*a-z-]+)*))/i;

function parsePackageName(spec) {
  if (!spec || spec.includes(':')) {
    return undefined;
  }
  const name = NAME_RE.exec(spec)?.groups?.name;
  return name && !builtins.has(name) ? name : undefined;
}

const parseVersion = (line) => VERSION_RE.exec(line)?.groups?.version;

/**
 * Collect third-party dependencies referenced by a script.
 *
 * @param {string|Buffer} content Script source.
 * @returns {Record<string, string>} Name → version (`latest` by default).
 */
export function parseDeps(content) {
  const tokens = depseek(`${content}\n`, { comments: true });
  const deps = {};
  tokens.forEach(({ type, value }, i) => {
    if (type !== 'dep') {
      return;
    }
    const name = parsePackageName(value);
    const meta = tokens[i + 1];
    const version =
      (meta?.type === 'comment' && parseVersion(meta.value.trim())) || 'latest';
    if (name) {
      deps[name] = version;
    }
  });
  return deps;
}
