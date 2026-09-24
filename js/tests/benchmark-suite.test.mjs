import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { join } from 'node:path';
import {
  BenchmarkRunner,
  summarizeSamples,
} from '../benchmarks/lib/benchmark-runner.mjs';
import {
  EXPECTED_ADAPTERS,
  executableForZx,
  loadCompetitorAdapters,
} from '../benchmarks/lib/competitor-adapters.mjs';
import { escapeHtml, writeReports } from '../benchmarks/lib/report.mjs';
import { parseArguments } from '../benchmarks/cli.mjs';
import { parseNpmPackOutput } from '../benchmarks/suites/bundle-size.mjs';
import { startLocalServer } from '../benchmarks/suites/real-world.mjs';
import {
  compareBenchmarkReports,
  regressionMarkdown,
} from '../benchmarks/lib/regression.mjs';

describe('benchmark statistics', () => {
  test('reports stable distribution statistics without rounding source data', () => {
    expect(summarizeSamples([1, 2, 3, 4])).toEqual({
      samples: 4,
      meanMs: 2.5,
      medianMs: 2.5,
      minMs: 1,
      maxMs: 4,
      p95Ms: 4,
      p99Ms: 4,
      standardDeviationMs: Math.sqrt(1.25),
      operationsPerSecond: 400,
    });
  });

  test('fails the suite when a measured result is invalid', async () => {
    const runner = new BenchmarkRunner({ iterations: 2, warmup: 0 });

    await expect(
      runner.compare('validation', {
        broken: {
          run: async () => 'wrong',
          validate: (value) => value === 'expected',
        },
      })
    ).rejects.toThrow('validation failed');
  });

  test('measures every implementation the requested number of times', async () => {
    const calls = { alpha: 0, beta: 0 };
    const runner = new BenchmarkRunner({ iterations: 3, warmup: 2 });
    const result = await runner.compare('complete sample', {
      alpha: {
        run: async () => ++calls.alpha,
        validate: Number.isInteger,
      },
      beta: {
        run: async () => ++calls.beta,
        validate: Number.isInteger,
      },
    });

    expect(calls).toEqual({ alpha: 5, beta: 5 });
    expect(result.implementations.alpha.samples).toBe(3);
    expect(result.implementations.beta.samples).toBe(3);
    expect(result.ranking.map(({ name }) => name).sort()).toEqual([
      'alpha',
      'beta',
    ]);
  });
});

describe('competitor adapters', () => {
  test('makes Windows executables addressable by zx default Bash', () => {
    expect(executableForZx('C:\\Program Files\\Bun\\bun.exe', 'win32')).toBe(
      'C:/Program Files/Bun/bun.exe'
    );
    expect(executableForZx('/usr/bin/bun', 'linux')).toBe('/usr/bin/bun');
  });

  test('executes the same exact-argv workload through every available API', async () => {
    const adapters = await loadCompetitorAdapters();
    const names = adapters.map(({ name }) => name);

    expect(names).toEqual(
      EXPECTED_ADAPTERS.filter(
        (name) => name !== 'Bun.$' || typeof globalThis.Bun !== 'undefined'
      )
    );

    for (const adapter of adapters) {
      expect(adapter.version.length).toBeGreaterThan(0);
      const result = await adapter.run(process.execPath, [
        '-e',
        'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        'hello world',
        '$literal',
      ]);
      expect(`${adapter.name}: ${result.exitCode}`).toBe(`${adapter.name}: 0`);
      expect(JSON.parse(result.stdout)).toEqual(['hello world', '$literal']);
      expect(result.stderr?.toString()).toBe('');
    }
  });
});

describe('benchmark reports', () => {
  test('escapes measured labels before writing HTML', () => {
    expect(escapeHtml('<script>"x" & y</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;'
    );
  });

  test('writes machine-readable and interactive reports', async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'benchmark-report-'));
    try {
      const paths = await writeReports(
        {
          schemaVersion: 1,
          generatedAt: '2026-09-15T00:00:00.000Z',
          environment: { runtime: 'test' },
          suites: [],
        },
        outputDirectory
      );
      expect(paths.json.endsWith('benchmark-results.json')).toBe(true);
      expect(paths.html.endsWith('benchmark-report.html')).toBe(true);
    } finally {
      rmSync(outputDirectory, { force: true, recursive: true });
    }
  });
});

describe('benchmark CLI inputs', () => {
  test('parses focused playground options', () => {
    const options = parseArguments([
      '--suite',
      'performance,features',
      '--adapter',
      'command-stream,execa',
      '--iterations',
      '7',
      '--warmup',
      '1',
      '--smoke',
    ]);
    expect(options.suites).toEqual(['performance', 'features']);
    expect(options.adapters).toEqual(['command-stream', 'execa']);
    expect(options.iterations).toBe(7);
    expect(options.warmup).toBe(1);
    expect(options.smoke).toBe(true);
  });

  test('rejects unknown suites before running commands', () => {
    expect(() => parseArguments(['--suite', 'imaginary'])).toThrow(
      'Unknown suite: imaginary'
    );
    expect(() => parseArguments(['--iterations'])).toThrow(
      '--iterations expects a value'
    );
    expect(() => parseArguments(['--adapter', ''])).toThrow(
      'Unknown adapter: (empty)'
    );
  });

  test('accepts npm 10 array and npm 12 keyed pack output', () => {
    const record = { size: 123, unpackedSize: 456, entryCount: 7 };
    expect(parseNpmPackOutput(JSON.stringify([record]))).toEqual({
      packedBytes: 123,
      unpackedBytes: 456,
      fileCount: 7,
    });
    expect(
      parseNpmPackOutput(JSON.stringify({ 'example-package': record }))
    ).toEqual({
      packedBytes: 123,
      unpackedBytes: 456,
      fileCount: 7,
    });
  });
});

describe('benchmark regression comparison', () => {
  const report = (medianMs, generatedAt) => ({
    generatedAt,
    suites: [
      {
        kind: 'performance',
        name: 'Performance',
        scenarios: [
          {
            name: 'spawn',
            implementations: { command: { medianMs } },
          },
        ],
      },
    ],
  });

  test('classifies material changes while retaining exact measurements', () => {
    const comparison = compareBenchmarkReports(
      report(10, 'before'),
      report(13, 'after'),
      { thresholdPercent: 20, minimumAbsoluteMs: 2 }
    );
    expect(comparison.summary).toEqual({
      compared: 1,
      regressions: 1,
      improvements: 0,
      stable: 0,
    });
    expect(comparison.comparisons[0]).toMatchObject({
      baselineMedianMs: 10,
      currentMedianMs: 13,
      deltaMs: 3,
      deltaPercent: 30,
      status: 'regression',
    });
    expect(regressionMarkdown(comparison)).toContain('| regression |');
  });

  test('does not classify sub-millisecond noise as a regression', () => {
    const comparison = compareBenchmarkReports(
      report(1, 'before'),
      report(1.5, 'after')
    );
    expect(comparison.summary.stable).toBe(1);
  });
});

describe('real-world benchmark fixtures', () => {
  test('handles an HTTP request split across packets', async () => {
    const server = await startLocalServer();
    try {
      const { hostname, port, pathname } = new URL(server.url);
      const response = await new Promise((resolve, reject) => {
        const chunks = [];
        const socket = connect(Number(port), hostname, () => {
          socket.write('G');
          setTimeout(
            () =>
              socket.end(
                `ET ${pathname} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n\r\n`
              ),
            10
          );
        });
        socket.setTimeout(2_000, () =>
          socket.destroy(new Error('fragmented HTTP request timed out'))
        );
        socket.on('data', (chunk) => chunks.push(chunk));
        socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
        socket.on('error', reject);
      });

      expect(response).toContain('HTTP/1.1 200 OK');
      expect(response).toContain('\r\nbenchmark-ok\r\n');
    } finally {
      await server.close();
    }
  });
});
