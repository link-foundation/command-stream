import { debug } from './debug-print.mjs';

export const DEFAULT_NPM_REGISTRY_URL = 'https://registry.npmjs.org';

function getNpmRegistryFromEnv() {
  try {
    // npm itself reads the lowercase `npm_config_registry` form, so honor both.
    return (
      process.env.NPM_CONFIG_REGISTRY || process.env.npm_config_registry || ''
    );
  } catch {
    return '';
  }
}

/**
 * Normalize an npm registry URL so package metadata paths can be appended.
 * @param {string} registryUrl
 * @returns {string}
 */
export function normalizeRegistryUrl(
  registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL
) {
  return String(registryUrl || DEFAULT_NPM_REGISTRY_URL).replace(/\/+$/, '');
}

/**
 * Encode a package name for npm registry metadata URLs.
 * @param {string} packageName
 * @returns {string}
 */
export function encodePackageName(packageName) {
  if (typeof packageName !== 'string' || packageName.trim() === '') {
    throw new Error('Package name is required');
  }

  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.split('/');
    if (!scope || !name) {
      throw new Error(`Invalid scoped package name: ${packageName}`);
    }
    return `${scope}%2F${encodeURIComponent(name)}`;
  }

  return encodeURIComponent(packageName);
}

/**
 * Build the npm registry package metadata URL.
 * @param {string} packageName
 * @param {string} registryUrl
 * @returns {string}
 */
export function buildPackageMetadataUrl(
  packageName,
  registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL
) {
  return `${normalizeRegistryUrl(registryUrl)}/${encodePackageName(packageName)}`;
}

export function buildPackageVersionUrl(packageName, version, registryUrl) {
  return `${buildPackageMetadataUrl(packageName, registryUrl)}/${encodeURIComponent(version)}`;
}

function traceResponse(response, packageName, version) {
  debug('npm verification response', {
    packageName,
    version,
    status: response.status,
    cacheStatus: response.headers?.get('cf-cache-status'),
    cacheControl: response.headers?.get('cache-control'),
    age: response.headers?.get('age'),
  });
}

/**
 * Check whether a package version exists in npm registry metadata.
 * HTTP 404 means the package has not been published yet and is not an error.
 * @param {string} packageName
 * @param {string} version
 * @param {object} options
 * @param {Function} [options.fetchFn]
 * @param {string} [options.registryUrl]
 * @returns {Promise<boolean>}
 */
export async function isPackageVersionPublished(
  packageName,
  version,
  {
    fetchFn = fetch,
    registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL,
    timeoutMs = 10000,
  } = {}
) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('Package version is required');
  }

  // A package-wide packument can stay cached for five minutes after a publish.
  // Query the exact version and request a fresh response, as npm's registry
  // API supports, rather than interpreting an old version list as a failed push.
  const metadataUrl = new URL(
    buildPackageVersionUrl(packageName, version, registryUrl)
  );
  metadataUrl.searchParams.set('cache-bust', String(Date.now()));
  const response = await fetchFn(metadataUrl.toString(), {
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  traceResponse(response, packageName, version);

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch npm package metadata for ${packageName}: ${response.status} ${response.statusText}`
    );
  }

  const metadata = await response.json();
  return metadata?.name === packageName && metadata?.version === version;
}
