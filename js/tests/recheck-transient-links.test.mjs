// The link check's re-check step (#216): lychee 0.24 reports a 503 after a
// single request, so .github/scripts/recheck-transient-links.mjs fetches
// 429/5xx/timeout links again and fails only on links that stay broken.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReport } from '../../.github/scripts/recheck-transient-links.mjs';

const script = fileURLToPath(
  new URL('../../.github/scripts/recheck-transient-links.mjs', import.meta.url)
);

// Paths answer with the listed statuses in turn, then repeat the last one.
const answers = {
  '/flaky': [503, 200],
  '/limited': [429, 429, 200],
  '/down': [503],
  '/gone': [404],
  '/ok': [200],
};
let hits;
let server;
let base;
let dir;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      hits[path] = (hits[path] ?? 0) + 1;
      const statuses = answers[path] ?? [404];
      const status = statuses[Math.min(hits[path], statuses.length) - 1];
      return new Response(null, { status });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  dir = mkdtempSync(join(tmpdir(), 'link-recheck-'));
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

// The format lychee 0.24.2 writes with `--format markdown` (captured from a
// real run: dev/log/issues/216/pulls/217/validation/lychee-0.24.2-report-sample.md).
function report(...entries) {
  return [
    '# Summary',
    '',
    '## Errors per input',
    '',
    '### Errors in docs/features/builtin-filesystem.md',
    '',
    ...entries.map(
      ([marker, path]) =>
        `* [${marker}] <${base}${path}> (at 17:1) | Rejected status code: ${marker}`
    ),
    '',
  ].join('\n');
}

// Async spawn: a synchronous one would block the mock server's event loop.
function run(exitCode, content) {
  hits = {};
  const file = join(dir, 'out.md');
  if (content !== undefined) {
    writeFileSync(file, content);
  }
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, file], {
      env: {
        ...process.env,
        LYCHEE_EXIT_CODE: exitCode,
        LINK_RECHECK_WAIT_MS: '1',
        LINK_RECHECK_ATTEMPTS: '3',
      },
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('close', (status) => done({ status, stdout }));
  });
}

describe('lychee report parsing', () => {
  test('reads each failure once, with its marker and transience', () => {
    const entries = parseReport(
      [
        '* [503] <https://example.com/a> (at 1:1) | Rejected status code: 503',
        '* [404] <https://example.com/b> (at 2:1) | Rejected status code: 404',
        '* [503] <https://example.com/a> (at 9:1) | Rejected status code: 503',
        '* [TIMEOUT] <https://example.com/c> (at 5:1) | Request timed out',
        '* [ERROR] <http://127.0.0.1:1/d> (at 6:1) | Connection refused',
      ].join('\n')
    );
    expect(entries).toEqual([
      { marker: '503', url: 'https://example.com/a', transient: true },
      { marker: '404', url: 'https://example.com/b', transient: false },
      { marker: 'TIMEOUT', url: 'https://example.com/c', transient: true },
      { marker: 'ERROR', url: 'http://127.0.0.1:1/d', transient: true },
    ]);
  });
});

describe('the re-check step', () => {
  test('a clean lychee run passes without fetching anything', async () => {
    const result = await run('0');
    expect(result.status).toBe(0);
    expect(hits).toEqual({});
  });

  test('a 503 that recovers is a warning, not a failure', async () => {
    const result = await run(
      '2',
      report(['503', '/flaky'], ['429', '/limited'])
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`::warning::[503] ${base}/flaky`);
    expect(hits).toEqual({ '/flaky': 2, '/limited': 3 });
  });

  test('a 503 that never recovers fails after the bounded re-checks', async () => {
    const result = await run('2', report(['503', '/down']));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `::error::[503] ${base}/down still failing`
    );
    expect(hits).toEqual({ '/down': 3 });
  });

  test('a 404 fails at once and is never fetched again', async () => {
    const result = await run('2', report(['404', '/gone'], ['503', '/flaky']));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`::error::[404] ${base}/gone`);
    expect(hits).toEqual({ '/flaky': 2 });
  });

  test('a re-check answering a final status stops early', async () => {
    answers['/moved'] = [404];
    const result = await run('2', report(['502', '/moved']));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('(last: 404)');
    expect(hits).toEqual({ '/moved': 1 });
  });

  test('a report it cannot read fails closed', async () => {
    const result = await run('2', '# Summary\n');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('lists none this script can read');
  });

  test('lychee failing for any other reason fails, as does a missing code', async () => {
    for (const code of ['3', '1', '']) {
      const result = await run(code);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('not a link failure');
    }
  });
});
