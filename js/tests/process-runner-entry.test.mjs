import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(testDirectory, '..');
const packageJson = JSON.parse(
  readFileSync(resolve(packageDirectory, 'package.json'), 'utf8')
);
const processRunnerExport = packageJson.exports['./process-runner'];
const terminalDependencies = new Set([
  '@resvg/resvg-js',
  '@xterm/headless',
  'gifenc',
  'node-pty',
]);

function collectModuleGraph(entrypoint) {
  const pending = [entrypoint];
  const modules = new Set();
  const packages = new Set();
  const importPattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (modules.has(modulePath)) {
      continue;
    }
    modules.add(modulePath);

    const source = readFileSync(modulePath, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) {
        pending.push(resolve(dirname(modulePath), specifier));
      } else if (!specifier.startsWith('node:')) {
        packages.add(specifier);
      }
    }
  }

  return { modules, packages };
}

test('exports a fully initialized ProcessRunner subpath', async () => {
  expect(processRunnerExport).toBe('./src/process-runner.mjs');

  const { ProcessRunner } = await import('command-stream/process-runner');
  expect(typeof ProcessRunner.prototype.start).toBe('function');

  const runner = new ProcessRunner(
    {
      mode: 'exec',
      file: process.execPath,
      args: ['-e', "process.stdout.write('lightweight runner')"],
    },
    { capture: true, mirror: false, stdin: 'ignore' }
  );
  const result = await runner;

  expect(result.code).toBe(0);
  expect(result.stdout).toBe('lightweight runner');
});

test('keeps terminal features out of the ProcessRunner module graph', () => {
  if (!processRunnerExport) {
    throw new Error('command-stream/process-runner is not exported');
  }

  const entrypoint = resolve(packageDirectory, processRunnerExport);
  const graph = collectModuleGraph(entrypoint);
  const terminalModules = [...graph.modules]
    .map((modulePath) => relative(packageDirectory, modulePath))
    .filter((modulePath) => modulePath.includes('terminal-'));
  const importedTerminalDependencies = [...graph.packages].filter((specifier) =>
    terminalDependencies.has(specifier)
  );

  expect(terminalModules).toEqual([]);
  expect(importedTerminalDependencies).toEqual([]);
});
