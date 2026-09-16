import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessRunner, exec } from '../../src/$.mjs';

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = join(benchmarkDirectory, 'fixtures', 'workload.mjs');

const casesFor = (adapters, args, validate) =>
  Object.fromEntries(
    adapters.map((adapter) => [
      adapter.name,
      {
        run: () => adapter.run(process.execPath, [fixture, ...args]),
        validate,
      },
    ])
  );

function concurrentCases(adapters, jobs) {
  return Object.fromEntries(
    adapters.map((adapter) => [
      adapter.name,
      {
        run: () =>
          Promise.all(
            Array.from({ length: jobs }, (_, index) =>
              adapter.run(process.execPath, [fixture, 'echo', String(index)])
            )
          ),
        validate: (results) =>
          results.every(
            (result, index) =>
              result.exitCode === 0 &&
              result.stdout === JSON.stringify([String(index)])
          ),
      },
    ])
  );
}

function streamCommand(bytes) {
  return new ProcessRunner(
    {
      mode: 'exec',
      file: process.execPath,
      args: [fixture, 'emit', String(bytes)],
    },
    { capture: true, mirror: false, stdin: 'ignore' }
  );
}

async function consumeStream(bytes) {
  let received = 0;
  let exitCode = null;
  for await (const chunk of streamCommand(bytes).stream()) {
    if (chunk.type === 'stdout') {
      received += Buffer.byteLength(chunk.data);
    }
    if (chunk.type === 'exit') {
      exitCode = chunk.code;
    }
  }
  return { received, exitCode };
}

async function bufferedCommand(bytes) {
  const result = await exec(
    process.execPath,
    [fixture, 'emit', String(bytes)],
    {
      capture: true,
      mirror: false,
      stdin: 'ignore',
    }
  );
  return { received: Buffer.byteLength(result.stdout), exitCode: result.code };
}

function fixtureRunner(mode, value, options = {}) {
  return new ProcessRunner(
    {
      mode: 'exec',
      file: process.execPath,
      args: [fixture, mode, String(value)],
    },
    { capture: true, mirror: false, stdin: 'ignore', ...options }
  );
}

async function programmaticPipeline(bytes) {
  const result = await fixtureRunner('emit', bytes).pipe(
    fixtureRunner('stdin-count', '', { stdin: 'pipe' })
  );
  return { exitCode: result.code, received: result.stdout };
}

async function bufferedPipeline(bytes) {
  const source = await fixtureRunner('emit', bytes);
  const destination = await fixtureRunner('stdin-count', '', {
    stdin: source.stdout,
  });
  return { exitCode: destination.code, received: destination.stdout };
}

async function builtInEcho() {
  const result = await exec('echo', ['benchmark'], {
    capture: true,
    mirror: false,
    stdin: 'ignore',
  });
  return result.stdout.trim();
}

export async function runPerformanceSuite({ runner, adapters, smoke = false }) {
  const outputBytes = smoke ? 64 * 1024 : 1024 * 1024;
  const jobs = smoke ? 2 : 8;
  const scenarioOptions = smoke ? { iterations: 2, warmup: 1 } : {};
  const scenarios = [];

  scenarios.push(
    await runner.compare(
      'Process spawn latency',
      casesFor(
        adapters,
        ['echo', 'benchmark'],
        (result) => result.exitCode === 0 && result.stdout === '["benchmark"]'
      ),
      scenarioOptions
    )
  );
  scenarios.push(
    await runner.compare(
      `Buffered stdout throughput (${outputBytes} bytes)`,
      casesFor(
        adapters,
        ['emit', String(outputBytes)],
        (result) =>
          result.exitCode === 0 &&
          Buffer.byteLength(result.stdout) === outputBytes
      ),
      scenarioOptions
    )
  );
  scenarios.push(
    await runner.compare(
      `Concurrent execution (${jobs} processes)`,
      concurrentCases(adapters, jobs),
      scenarioOptions
    )
  );
  scenarios.push(
    await runner.compare(
      'Non-zero exit handling',
      casesFor(
        adapters,
        ['fail', '17'],
        (result) =>
          result.exitCode === 17 &&
          result.stderr === 'intentional benchmark failure'
      ),
      scenarioOptions
    )
  );
  scenarios.push(
    await runner.compare(
      `command-stream output modes (${outputBytes} bytes)`,
      {
        buffered: {
          run: () => bufferedCommand(outputBytes),
          validate: ({ received, exitCode }) =>
            received === outputBytes && exitCode === 0,
        },
        streaming: {
          run: () => consumeStream(outputBytes),
          validate: ({ received, exitCode }) =>
            received === outputBytes && exitCode === 0,
        },
      },
      scenarioOptions
    )
  );
  scenarios.push(
    await runner.compare(
      `command-stream pipeline throughput (${outputBytes} bytes)`,
      {
        'pipe() API': {
          run: () => programmaticPipeline(outputBytes),
          validate: ({ exitCode, received }) =>
            exitCode === 0 && received === String(outputBytes),
        },
        'manual two-step': {
          run: () => bufferedPipeline(outputBytes),
          validate: ({ exitCode, received }) =>
            exitCode === 0 && received === String(outputBytes),
        },
      },
      scenarioOptions
    )
  );
  scenarios.push(
    await runner.compare(
      'command-stream built-in vs system process',
      {
        'built-in echo': {
          run: builtInEcho,
          validate: (output) => output === 'benchmark',
        },
        'spawned workload': {
          run: async () => {
            const result = await exec(
              process.execPath,
              [fixture, 'echo', 'benchmark'],
              { capture: true, mirror: false, stdin: 'ignore' }
            );
            return result.stdout;
          },
          validate: (output) => output === '["benchmark"]',
        },
      },
      scenarioOptions
    )
  );

  return {
    kind: 'performance',
    name: 'Performance',
    scenarios,
  };
}
