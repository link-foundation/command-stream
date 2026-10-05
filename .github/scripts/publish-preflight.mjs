// Validate release credentials without publishing, persisting, or logging them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function jsonRequest(fetchFn, url, options = {}) {
  const response = await fetchFn(url, {
    ...options,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Credential preflight rejected (HTTP ${response.status})`);
  }
  return response.json();
}

export async function checkNpmPublisher({
  packageName,
  env = process.env,
  fetchFn = fetch,
}) {
  if (
    !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error('npm trusted publishing requires GitHub id-token: write');
  }
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', 'npm:registry.npmjs.org');
  const identity = await jsonRequest(fetchFn, url, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (!identity.value) {
    throw new Error('GitHub returned no OIDC identity');
  }
  const escapedName = encodeURIComponent(packageName);
  const result = await jsonRequest(
    fetchFn,
    `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${escapedName}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${identity.value}` },
    }
  );
  if (typeof result.token !== 'string' || !result.token) {
    throw new Error('npm returned no publish credential');
  }
}

export async function checkCratePublisher({
  packageName,
  env = process.env,
  fetchFn = fetch,
}) {
  const token = env.CARGO_REGISTRY_TOKEN || env.CARGO_TOKEN;
  if (!token) {
    throw new Error('Missing crates.io publish credential');
  }
  const headers = {
    Authorization: token,
    'User-Agent': 'command-stream CI credential preflight',
  };
  // /api/v1/me is cookie-only and rejects valid Cargo API tokens.
  // The publish handler authenticates and checks crate/endpoint scopes before
  // reading the archive length. Omit that length and the archive completely:
  // the only accepted response proves we reached that check without publishing.
  // Source: rust-lang/crates.io/src/controllers/krate/publish.rs.
  const metadata = Buffer.from(
    JSON.stringify({ name: packageName, vers: '0.0.0-preflight' })
  );
  const body = Buffer.alloc(metadata.length + 4);
  body.writeUInt32LE(metadata.length);
  metadata.copy(body, 4);
  const response = await fetchFn('https://crates.io/api/v1/crates/new', {
    method: 'PUT',
    headers,
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 400) {
    throw new Error(
      `crates.io credential preflight rejected (HTTP ${response.status})`
    );
  }
  const result = await response.json();
  if (
    result.errors?.length !== 1 ||
    result.errors[0].detail !== 'invalid tarball length'
  ) {
    throw new Error(
      'crates.io did not confirm the publish credential and scope'
    );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    if (process.argv[2] === 'npm') {
      const { name } = JSON.parse(readFileSync('js/package.json', 'utf8'));
      await checkNpmPublisher({ packageName: name });
    } else if (process.argv[2] === 'crates') {
      const manifest = readFileSync('rust/Cargo.toml', 'utf8');
      const name = manifest.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
      if (!name) {
        throw new Error('Missing crate name');
      }
      await checkCratePublisher({ packageName: name });
    } else {
      throw new Error(
        'Usage: node .github/scripts/publish-preflight.mjs npm|crates'
      );
    }
    console.log('Registry credential preflight passed');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
