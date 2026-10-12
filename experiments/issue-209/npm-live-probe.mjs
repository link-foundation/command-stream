// Preserve registry visibility/cache evidence; credentials and cookies excluded.
import { writeFileSync } from 'node:fs';
const results = [];
for (const suffix of ['', '/1.4.0', `/1.4.0?cache-bust=${Date.now()}`]) {
  const response = await fetch(
    `https://registry.npmjs.org/command-stream${suffix}`,
    {
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(10000),
    }
  );
  const data = await response.json();
  results.push({
    at: new Date().toISOString(),
    suffix,
    status: response.status,
    headers: Object.fromEntries(
      ['cache-control', 'cf-cache-status', 'age', 'last-modified'].map(
        (name) => [name, response.headers.get(name)]
      )
    ),
    version: data.version,
    published: data.time?.['1.4.0'],
    visible: Boolean(data.versions?.['1.4.0'] || data.version === '1.4.0'),
  });
}
writeFileSync(
  process.argv[2] ||
    'dev/log/issues/209/pulls/210/research/npm-live-probe-current.json',
  JSON.stringify(results, null, 2)
);
