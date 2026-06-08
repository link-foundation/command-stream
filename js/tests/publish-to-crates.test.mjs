import { test, expect } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function withMockCratesApi(status, body, fn) {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(body, {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  try {
    return await fn(server.url.href.replace(/\/$/, ''));
  } finally {
    server.stop(true);
  }
}

async function streamToText(stream) {
  return stream ? await new Response(stream).text() : '';
}

async function runPublisher(baseUrl) {
  const subprocess = Bun.spawn(
    ['bun', 'scripts/publish-to-crates.mjs', '--working-dir', 'rust'],
    {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        CARGO_REGISTRY_TOKEN: '',
        CARGO_TOKEN: '',
        CRATES_IO_BASE_URL: baseUrl,
      },
    }
  );

  const [status, stdout, stderr] = await Promise.all([
    subprocess.exited,
    streamToText(subprocess.stdout),
    streamToText(subprocess.stderr),
  ]);

  return { status, stdout, stderr };
}

test('publish-to-crates skips publish when crate version already exists', async () => {
  const result = await withMockCratesApi(200, '{}', (baseUrl) =>
    runPublisher(baseUrl)
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('published=true');
  expect(result.stdout).toContain('already_published=true');
  expect(result.stdout).toContain('publish_result=already_published');
});

test('publish-to-crates requires a token only for unpublished crate versions', async () => {
  const result = await withMockCratesApi(404, '{}', (baseUrl) =>
    runPublisher(baseUrl)
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Missing crates.io token');
});
