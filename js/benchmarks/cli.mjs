#!/usr/bin/env bun

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BenchmarkRunner } from './lib/benchmark-runner.mjs';
import {
  EXPECTED_ADAPTERS,
  loadCompetitorAdapters,
} from './lib/competitor-adapters.mjs';
import { writeReports } from './lib/report.mjs';
import { runBundleSizeSuite } from './suites/bundle-size.mjs';
import { runFeatureSuite } from './suites/features.mjs';
import { runPerformanceSuite } from './suites/performance.mjs';
import { runRealWorldSuite } from './suites/real-world.mjs';

const suiteNames = ['performance', 'bundle-size', 'features', 'real-world'];

function usage() {
  return `command-stream benchmark playground

Usage: bun benchmarks/cli.mjs [options]

  --suite <name[,name]>    Select suites (default: all)
  --adapter <name[,name]>  Select process APIs (default: all available)
  --iterations <count>     Measured iterations per timing scenario (default: 30)
  --warmup <count>         Warmup iterations per implementation (default: 5)
  --output <directory>     Report directory (default: benchmarks/results)
  --smoke                  Use tiny deterministic workloads for CI
  --list                   List suites and adapters
  --help                   Show this help
`;
}

function integer(value, flag, minimum) {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    String(parsed) !== value
  ) {
    throw new Error(`${flag} expects an integer >= ${minimum}`);
  }
  return parsed;
}

function commaList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function applyValueOption(options, flag, value) {
  if (value === undefined) {
    throw new Error(`${flag} expects a value`);
  }
  if (flag === '--suite') {
    options.suites = commaList(value);
  } else if (flag === '--adapter') {
    options.adapters = commaList(value);
  } else if (flag === '--iterations') {
    options.iterations = integer(value, flag, 1);
  } else if (flag === '--warmup') {
    options.warmup = integer(value, flag, 0);
  } else if (flag === '--output') {
    options.output = resolve(value);
  } else {
    return false;
  }
  return true;
}

export function parseArguments(argv) {
  const options = {
    adapters: null,
    help: false,
    iterations: 30,
    list: false,
    output: resolve('benchmarks/results'),
    smoke: false,
    suites: [...suiteNames],
    warmup: 5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') {
      options.help = true;
    } else if (flag === '--list') {
      options.list = true;
    } else if (flag === '--smoke') {
      options.smoke = true;
    } else if (!applyValueOption(options, flag, argv[index + 1])) {
      throw new Error(`Unknown argument: ${flag}`);
    } else {
      index += 1;
    }
  }

  const invalidSuites = options.suites.filter(
    (name) => !suiteNames.includes(name)
  );
  if (options.suites.length === 0 || invalidSuites.length > 0) {
    throw new Error(`Unknown suite: ${invalidSuites[0] ?? '(empty)'}`);
  }
  const invalidAdapters = (options.adapters ?? []).filter(
    (name) => !EXPECTED_ADAPTERS.includes(name)
  );
  if (options.adapters?.length === 0 || invalidAdapters.length > 0) {
    throw new Error(`Unknown adapter: ${invalidAdapters[0] ?? '(empty)'}`);
  }
  return options;
}

function printScenario(scenario) {
  console.log(`\n${scenario.name}`);
  for (const entry of scenario.ranking) {
    console.log(
      `  ${entry.rank}. ${entry.name.padEnd(16)} ${entry.medianMs.toFixed(2).padStart(9)} ms  ${entry.relativeToFastest.toFixed(2)}x`
    );
  }
}

function printSuite(suite) {
  console.log(`\n## ${suite.name}`);
  if (suite.scenarios) {
    suite.scenarios.forEach(printScenario);
  } else if (suite.competitors) {
    for (const entry of suite.competitors) {
      console.log(
        `  ${entry.name.padEnd(16)} ${entry.supported} ported / ${entry.gaps} known gaps (${entry.coveragePercent.toFixed(1)}%)`
      );
    }
  } else if (suite.packages) {
    for (const entry of suite.packages) {
      console.log(
        `  ${entry.name.padEnd(16)} pack ${String(entry.packedBytes).padStart(9)} B  minimal bundle ${String(entry.minimalBundleBytes).padStart(9)} B`
      );
    }
  }
}

async function selectedAdapters(names) {
  const available = await loadCompetitorAdapters();
  if (!names) {
    return available;
  }
  const selected = available.filter(({ name }) => names.includes(name));
  const unavailable = names.filter(
    (name) => !selected.some((item) => item.name === name)
  );
  if (unavailable.length > 0) {
    throw new Error(
      `${unavailable.join(', ')} unavailable in ${typeof globalThis.Bun === 'undefined' ? 'Node.js' : 'Bun'}`
    );
  }
  return selected;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  if (options.list) {
    console.log(`Suites: ${suiteNames.join(', ')}`);
    console.log(`Adapters: ${EXPECTED_ADAPTERS.join(', ')}`);
    return null;
  }

  const needsAdapters = options.suites.some((name) =>
    ['performance', 'real-world'].includes(name)
  );
  const adapters = needsAdapters
    ? await selectedAdapters(options.adapters)
    : [];
  const runner = new BenchmarkRunner({
    iterations: options.iterations,
    warmup: options.warmup,
  });
  const suites = [];

  for (const suite of options.suites) {
    console.log(`\nRunning ${suite}...`);
    if (suite === 'performance') {
      suites.push(
        await runPerformanceSuite({ runner, adapters, smoke: options.smoke })
      );
    } else if (suite === 'bundle-size') {
      suites.push(await runBundleSizeSuite());
    } else if (suite === 'features') {
      suites.push(runFeatureSuite());
    } else if (suite === 'real-world') {
      suites.push(
        await runRealWorldSuite({ runner, adapters, smoke: options.smoke })
      );
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      arch: process.arch,
      bun: process.versions.bun ?? null,
      cpus: globalThis.navigator?.hardwareConcurrency ?? null,
      node: process.versions.node,
      platform: process.platform,
      runtime:
        typeof globalThis.Bun === 'undefined'
          ? `Node.js ${process.version}`
          : `Bun ${globalThis.Bun.version}`,
    },
    configuration: {
      adapters: adapters.map(({ name, version }) => ({ name, version })),
      runnerDefaults: {
        iterations: options.iterations,
        warmup: options.warmup,
      },
      smoke: options.smoke,
      suites: options.suites,
    },
    suites,
  };
  suites.forEach(printSuite);
  const paths = await writeReports(report, options.output);
  console.log(`\nJSON: ${paths.json}`);
  console.log(`HTML: ${paths.html}`);
  return report;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
