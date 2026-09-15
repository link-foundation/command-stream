import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const jsDirectory = dirname(benchmarkDirectory);
const fixture = join(benchmarkDirectory, 'fixtures', 'workload.mjs');

const adapterCases = (adapters, run, validate) =>
  Object.fromEntries(
    adapters.map((adapter) => [
      adapter.name,
      { run: () => run(adapter), validate },
    ])
  );

async function createData() {
  const directory = await mkdtemp(join(tmpdir(), 'command-stream-benchmark-'));
  const files = join(directory, 'files');
  await mkdir(files);
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      writeFile(
        join(files, `${String(index).padStart(2, '0')}.txt`),
        `file-${index}\n`
      )
    )
  );
  const log = join(directory, 'application.log');
  const levels = ['INFO', 'INFO', 'WARN', 'INFO', 'ERROR'];
  await writeFile(
    log,
    `${Array.from(
      { length: 1000 },
      (_, index) =>
        `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}Z ${levels[index % levels.length]} event-${index}`
    ).join('\n')}\n`
  );
  return { directory, files, log };
}

async function startLocalServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('benchmark-ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/health`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

export async function runRealWorldSuite({ runner, adapters, smoke = false }) {
  const data = await createData();
  const server = await startLocalServer();
  const options = smoke ? { iterations: 1, warmup: 0 } : {};
  const scenarios = [];
  try {
    scenarios.push(
      await runner.compare(
        'CI/CD validation workflow (two steps)',
        adapterCases(
          adapters,
          (adapter) =>
            Promise.all([
              adapter.run(process.execPath, [
                fixture,
                'package-version',
                join(jsDirectory, 'package.json'),
              ]),
              adapter.run(process.execPath, [
                fixture,
                'source-digest',
                join(jsDirectory, 'src'),
              ]),
            ]),
          (results) =>
            results.length === 2 &&
            results.every(
              (result) => result.exitCode === 0 && result.stdout.length > 0
            )
        ),
        options
      )
    );
    scenarios.push(
      await runner.compare(
        'Log processing (1,000 records)',
        adapterCases(
          adapters,
          (adapter) =>
            adapter.run(process.execPath, [fixture, 'log-summary', data.log]),
          (result) =>
            result.exitCode === 0 &&
            result.stdout === '{"INFO":600,"WARN":200,"ERROR":200}'
        ),
        options
      )
    );
    scenarios.push(
      await runner.compare(
        'File operations (12 files)',
        adapterCases(
          adapters,
          (adapter) =>
            adapter.run(process.execPath, [fixture, 'file-digest', data.files]),
          (result) => result.exitCode === 0 && result.stdout.startsWith('12:')
        ),
        options
      )
    );
    scenarios.push(
      await runner.compare(
        'Local network command handling',
        adapterCases(
          adapters,
          (adapter) =>
            adapter.run(process.execPath, [fixture, 'http-get', server.url]),
          (result) =>
            result.exitCode === 0 && result.stdout === '200:benchmark-ok'
        ),
        options
      )
    );
  } finally {
    await Promise.all([
      server.close(),
      rm(data.directory, { force: true, recursive: true }),
    ]);
  }

  return {
    kind: 'real-world',
    name: 'Real-world workloads',
    scenarios,
  };
}
