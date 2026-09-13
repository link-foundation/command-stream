export const snapshotDate = '2026-09-13';

export const competitors = [
  {
    id: 'node-child-process',
    project: 'Node.js child_process',
    repository: 'nodejs/node',
    commit: '6193e15483395080c6438399211aa7fab70f4e5e',
    license: 'MIT',
    stars: 121848,
    sourceFiles: 117,
    registrationSites: null,
    scope: [
      'test/parallel/test-child-process-*.js',
      'test/sequential/test-child-process-*.js',
      'test/pummel/test-child-process-*.js',
    ],
    note: 'Node uses its own mustCall harness, so file count is the stable inventory unit.',
  },
  {
    id: 'bun-shell',
    project: 'Bun Shell and child_process',
    repository: 'oven-sh/bun',
    commit: '09bb5463058074ef143a9d9a5a405d669c787375',
    license: 'MIT',
    stars: 95955,
    sourceFiles: 53,
    registrationSites: 394,
    scope: [
      'test/js/bun/shell/**/*.test.*',
      'test/js/node/child_process/**/*.test.*',
    ],
  },
  {
    id: 'deno-command',
    project: 'Deno.Command and node:child_process',
    repository: 'denoland/deno',
    commit: '336da420f4343cbb1dcbd5eed9d075ff555ed6ee',
    license: 'MIT',
    stars: 108420,
    sourceFiles: 2,
    registrationSites: 137,
    scope: [
      'tests/unit/command_test.ts',
      'tests/unit_node/child_process_test.ts',
    ],
  },
  {
    id: 'execa',
    project: 'Execa',
    repository: 'sindresorhus/execa',
    commit: '8017b279e19347efaf2587711c2d57dbd4330740',
    license: 'MIT',
    stars: 7602,
    sourceFiles: 151,
    registrationSites: 5133,
    scope: ['test/**/*.js (excluding fixtures and helpers)'],
  },
  {
    id: 'zx',
    project: 'zx',
    repository: 'google/zx',
    commit: '65fc542d88baac578967e22bea28cb610976578c',
    license: 'Apache-2.0',
    stars: 45741,
    sourceFiles: 23,
    registrationSites: 290,
    scope: ['src/**/*.test.ts'],
  },
  {
    id: 'shelljs',
    project: 'ShellJS',
    repository: 'shelljs/shelljs',
    commit: 'f364da6625945414440bb15210f102ba5fc10ed9',
    license: 'BSD-3-Clause',
    stars: 14396,
    sourceFiles: 38,
    registrationSites: 694,
    scope: ['src/**/*.test.js (excluding resources and helpers)'],
  },
  {
    id: 'cross-spawn',
    project: 'cross-spawn',
    repository: 'moxystudio/node-cross-spawn',
    commit: '77cd97f3ca7b62c904a63a698fc4a79bf41977d0',
    license: 'MIT',
    stars: 1171,
    sourceFiles: 1,
    registrationSites: 25,
    scope: ['test/index.test.js'],
  },
  {
    id: 'dax',
    project: 'Dax and @david/shell',
    repository: 'dsherret/dax',
    commit: 'd5e8c18ee28a8317b098c860ee98786a828c0e04',
    license: 'MIT',
    stars: 1496,
    sourceFiles: 15,
    registrationSites: 399,
    scope: ['mod.test.ts', '@david/shell tests/*.test.ts'],
    note: 'Dax delegates command execution to @david/shell at eba92f9c9fcc58e02a8385097791056fd0d2b7ad.',
  },
  {
    id: 'nano-spawn',
    project: 'nano-spawn',
    repository: 'sindresorhus/nano-spawn',
    commit: 'cc231e2c7b1e434a96f25f907ca2cb2f7c596e90',
    license: 'MIT',
    stars: 592,
    sourceFiles: 8,
    registrationSites: 263,
    scope: ['test/**/*.js (excluding fixtures and helpers)'],
  },
  {
    id: 'actions-exec',
    project: '@actions/exec',
    repository: 'actions/toolkit',
    commit: '193fa46c20fde8b0ed54194bc08b841c78c0776d',
    license: 'MIT',
    stars: 5847,
    sourceFiles: 1,
    registrationSites: 32,
    scope: ['packages/exec/__tests__/exec.test.ts'],
  },
];

export const portedCases = [
  {
    id: 'direct-exact-argv',
    competitors: [
      'node-child-process',
      'deno-command',
      'execa',
      'cross-spawn',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test/arguments.js',
      'tests/unit/command_test.ts',
      'test/index.test.js',
    ],
  },
  {
    id: 'argument-edge-cases',
    competitors: [
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'cross-spawn',
      'dax',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test/js/bun/shell/shell-interpreter.test.ts',
      'test/arguments/escape.js',
      'mod.test.ts',
    ],
  },
  {
    id: 'safe-template-interpolation',
    competitors: ['bun-shell', 'zx', 'dax'],
    upstream: [
      'test/js/bun/shell/shell-interpreter.test.ts',
      'src/core.test.ts',
      'mod.test.ts',
    ],
  },
  {
    id: 'array-interpolation',
    competitors: ['bun-shell', 'zx', 'dax'],
    upstream: [
      'test/js/bun/shell/shell-interpreter.test.ts',
      'src/core.test.ts',
      'mod.test.ts',
    ],
  },
  {
    id: 'cwd-string',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'shelljs',
      'dax',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test/arguments/cwd.js',
      'tests/unit/command_test.ts',
      'packages/exec/__tests__/exec.test.ts',
    ],
  },
  {
    id: 'environment',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'shelljs',
      'dax',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test/arguments/env.js',
      'tests/unit/command_test.ts',
      'packages/exec/__tests__/exec.test.ts',
    ],
  },
  {
    id: 'stdout-stderr-separation',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'shelljs',
      'dax',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test/output.js',
      'tests/unit/command_test.ts',
      'packages/exec/__tests__/exec.test.ts',
    ],
  },
  {
    id: 'newline-preservation',
    competitors: [
      'node-child-process',
      'deno-command',
      'execa',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: ['test/output/strip-newline.js', 'tests/unit/command_test.ts'],
  },
  {
    id: 'unicode-output',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'dax',
    ],
    upstream: [
      'test/encoding.js',
      'test/js/bun/shell/shell-interpreter.test.ts',
    ],
  },
  {
    id: 'large-output',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'shelljs',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test-max-buffer.js',
      'test/output/max-buffer.js',
      'packages/exec/__tests__/exec.test.ts',
    ],
  },
  {
    id: 'nonzero-exit',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'shelljs',
      'cross-spawn',
      'dax',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test/return/failure.js',
      'tests/unit/command_test.ts',
      'test/index.test.js',
    ],
  },
  {
    id: 'result-text',
    competitors: ['bun-shell', 'execa', 'zx', 'dax', 'nano-spawn'],
    upstream: [
      'test/js/bun/shell/bunshell.test.ts',
      'test/return/result.js',
      'mod.test.ts',
    ],
  },
  {
    id: 'stdin-string',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'shelljs',
      'dax',
      'nano-spawn',
    ],
    upstream: [
      'test/arguments/input-option.js',
      'tests/unit/command_test.ts',
      'mod.test.ts',
    ],
  },
  {
    id: 'stdin-buffer',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'dax',
      'nano-spawn',
    ],
    upstream: ['test/arguments/input-option.js', 'tests/unit/command_test.ts'],
  },
  {
    id: 'lazy-execution',
    competitors: ['bun-shell', 'execa', 'zx', 'dax', 'nano-spawn'],
    upstream: [
      'test/js/bun/shell/bunshell.test.ts',
      'test/methods/main-sync.js',
      'mod.test.ts',
    ],
  },
  {
    id: 'concurrent-execution',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'shelljs',
      'dax',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: ['test/terminate/cleanup.js', 'tests/unit/command_test.ts'],
  },
  {
    id: 'streamed-before-exit',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'shelljs',
      'dax',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test/stream.js',
      'tests/unit/command_test.ts',
      'packages/exec/__tests__/exec.test.ts',
    ],
  },
  {
    id: 'events-and-await',
    competitors: [
      'node-child-process',
      'execa',
      'shelljs',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test-events.js',
      'test/output/async.js',
      'packages/exec/__tests__/exec.test.ts',
    ],
  },
  {
    id: 'sync-execution',
    competitors: [
      'node-child-process',
      'bun-shell',
      'deno-command',
      'execa',
      'shelljs',
      'cross-spawn',
    ],
    upstream: [
      'test-child-process-spawnsync.js',
      'test/methods/main-sync.js',
      'test/index.test.js',
    ],
  },
  {
    id: 'programmatic-pipeline',
    competitors: [
      'bun-shell',
      'deno-command',
      'execa',
      'zx',
      'shelljs',
      'dax',
      'nano-spawn',
    ],
    upstream: ['test/pipe.js', 'test/js/bun/shell/pipe.test.ts', 'mod.test.ts'],
  },
  {
    id: 'spawn-error-result',
    competitors: [
      'node-child-process',
      'deno-command',
      'execa',
      'cross-spawn',
      'nano-spawn',
      'actions-exec',
    ],
    upstream: [
      'test-child-process-spawn-error.js',
      'test/return/early-error.js',
      'test/index.test.js',
    ],
  },
  {
    id: 'abort-signal',
    competitors: [
      'node-child-process',
      'deno-command',
      'execa',
      'zx',
      'dax',
      'nano-spawn',
    ],
    upstream: [
      'test-child-process-spawn-signal.js',
      'test/terminate/abort.js',
      'mod.test.ts',
    ],
  },
];

export const missingFeatures = [
  { id: 'timeout-option', competitors: ['execa', 'zx', 'dax', 'nano-spawn'] },
  {
    id: 'ipc-and-fork',
    competitors: ['node-child-process', 'bun-shell', 'deno-command', 'execa'],
  },
  {
    id: 'custom-stdio-descriptors',
    competitors: ['node-child-process', 'bun-shell', 'deno-command', 'execa'],
  },
  {
    id: 'configurable-encoding',
    competitors: ['node-child-process', 'deno-command', 'execa', 'nano-spawn'],
  },
  {
    id: 'max-buffer-policy',
    competitors: ['node-child-process', 'execa', 'shelljs'],
  },
  {
    id: 'output-transforms-and-line-iteration',
    competitors: ['execa', 'zx', 'dax', 'nano-spawn'],
  },
  { id: 'local-binary-resolution', competitors: ['execa', 'zx'] },
  {
    id: 'windows-shebang-and-pathext-resolution',
    competitors: ['cross-spawn', 'nano-spawn'],
  },
  { id: 'shell-builtin-breadth', competitors: ['bun-shell', 'shelljs', 'dax'] },
  {
    id: 'rich-error-and-timing-metadata',
    competitors: ['execa', 'zx', 'nano-spawn', 'actions-exec'],
  },
  { id: 'graceful-termination', competitors: ['execa', 'zx', 'dax'] },
  { id: 'combined-all-output', competitors: ['execa', 'nano-spawn'] },
  {
    id: 'iterable-and-stream-input-options',
    competitors: ['execa', 'dax', 'nano-spawn'],
  },
  { id: 'url-working-directory', competitors: ['execa', 'dax'] },
];

export const excludedTestClasses = [
  {
    id: 'competitor-api-shape',
    reason:
      'Constructor names, exports, TypeScript types, snapshots, and competitor-specific return objects do not describe command-stream behavior.',
  },
  {
    id: 'competitor-internals',
    reason:
      'Mocks and assertions for private parsers, subprocess wrappers, logging internals, and implementation-only errors are not portable.',
  },
  {
    id: 'runtime-only-behavior',
    reason:
      'Bun and Deno runtime conformance that does not execute commands belongs to those runtimes, not command-stream.',
  },
  {
    id: 'unrelated-utilities',
    reason:
      'zx utilities, ShellJS filesystem commands, GitHub Actions tool-cache behavior, and Dax HTTP/console helpers are outside process execution.',
  },
  {
    id: 'platform-fixture-mechanics',
    reason:
      'Upstream harness setup, snapshots, permissions, CI probes, and fixture self-tests are test infrastructure rather than product behavior.',
  },
];

export function pinnedSourceUrl(competitor, path = '') {
  return `https://github.com/${competitor.repository}/blob/${competitor.commit}/${path}`;
}
