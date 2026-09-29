#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareBenchmarkReports,
  regressionMarkdown,
} from './lib/regression.mjs';

export async function main(argv = process.argv.slice(2)) {
  const [baselinePath, currentPath, outputDirectory = 'benchmarks/results'] =
    argv;
  if (!baselinePath || !currentPath) {
    throw new Error(
      'Usage: bun benchmarks/compare-results.mjs <baseline.json> <current.json> [output-directory]'
    );
  }
  const [baseline, current] = await Promise.all(
    [baselinePath, currentPath].map(async (filename) =>
      JSON.parse(await readFile(resolve(filename), 'utf8'))
    )
  );
  const comparison = compareBenchmarkReports(baseline, current);
  const jsonPath = resolve(outputDirectory, 'benchmark-regressions.json');
  const markdownPath = resolve(outputDirectory, 'benchmark-regressions.md');
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(comparison, null, 2)}\n`),
    writeFile(markdownPath, regressionMarkdown(comparison)),
  ]);
  console.log(regressionMarkdown(comparison));
  return comparison;
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
