#!/usr/bin/env node

// Rebuild the checked-in per-test disposition manifests from pinned upstream
// checkouts. See docs/COMPETITOR_TEST_AUDIT.md for the exact clone procedure.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required ${name} PATH argument`);
  }
  return process.argv[index + 1];
}

const jsRoot = option('--js-root');
const rustRoot = option('--rust-root');
const rustExtraRoot = option('--rust-extra-root');
const jsDecisionPath = join(
  import.meta.dirname,
  '../tests/competitor-decisions.jsonl'
);
const rustDecisionPath = join(
  import.meta.dirname,
  '../../rust/tests/competitor_decisions.jsonl'
);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function normalizedRelative(root, path) {
  return relative(root, path).replaceAll('\\', '/');
}

const jsSources = [
  {
    id: 'node-child-process',
    directory: 'node',
    repository: 'nodejs/node',
    commit: '6193e15483395080c6438399211aa7fab70f4e5e',
    select: (path) =>
      /^test\/(parallel|sequential|pummel)\/test-child-process-.*\.js$/.test(
        path
      ),
    fileUnits: true,
  },
  {
    id: 'bun-shell',
    directory: 'bun',
    repository: 'oven-sh/bun',
    commit: '09bb5463058074ef143a9d9a5a405d669c787375',
    select: (path) =>
      (path.startsWith('test/js/bun/shell/') ||
        path.startsWith('test/js/node/child_process/')) &&
      /\.test\.[cm]?[jt]sx?$/.test(path),
    registration: /(?<![\w$.])(?:test|it)(?:\.[A-Za-z_$][\w$]*)*\s*\(/g,
  },
  {
    id: 'deno-command',
    directory: 'deno',
    repository: 'denoland/deno',
    commit: '336da420f4343cbb1dcbd5eed9d075ff555ed6ee',
    select: (path) =>
      [
        'tests/unit/command_test.ts',
        'tests/unit_node/child_process_test.ts',
      ].includes(path),
    registration: /\bDeno\.test\s*\(/g,
  },
  {
    id: 'execa',
    directory: 'execa',
    repository: 'sindresorhus/execa',
    commit: '8017b279e19347efaf2587711c2d57dbd4330740',
    select: (path) =>
      path.startsWith('test/') &&
      path.endsWith('.js') &&
      !/(^|\/)(fixtures?|helpers?)(\/|\.|$)/i.test(path),
    registration: /(?<![\w$.])(?:test|it)(?:\.[A-Za-z_$][\w$]*)*\s*\(/g,
  },
  {
    id: 'zx',
    directory: 'zx',
    repository: 'google/zx',
    commit: '65fc542d88baac578967e22bea28cb610976578c',
    select: (path) =>
      path.startsWith('test/') && /\.test\.(?:[cm]?js|ts)$/.test(path),
    registration:
      /(?<![\w$.])(?:Deno\.test|test|it)(?:\.[A-Za-z_$][\w$]*)*\s*\(/g,
  },
  {
    id: 'shelljs',
    directory: 'shelljs',
    repository: 'shelljs/shelljs',
    commit: 'f364da6625945414440bb15210f102ba5fc10ed9',
    select: (path) =>
      path.startsWith('test/') &&
      path.endsWith('.js') &&
      !/(^|\/)(resources?|helpers?)(\/|\.|$)/i.test(path),
    registration: /(?<![\w$.])test(?:\.skip)?\s*\(/g,
  },
  {
    id: 'cross-spawn',
    directory: 'cross-spawn',
    repository: 'moxystudio/node-cross-spawn',
    commit: '77cd97f3ca7b62c904a63a698fc4a79bf41977d0',
    select: (path) => path === 'test/index.test.js',
    registration: /(?<![\w$.])(?:test|it)\s*\(/g,
  },
  {
    id: 'cross-env',
    directory: 'cross-env',
    repository: 'kentcdodds/cross-env',
    commit: '9951937a7d3d4a1ea7bd2ce3133bcfb687125813',
    select: (path) =>
      path.startsWith('src/__tests__/') && path.endsWith('.test.ts'),
    registration: /(?<![\w$.])(?:test|it)\s*\(/g,
  },
  {
    id: 'dax',
    directory: 'dax',
    repository: 'dsherret/dax',
    commit: 'd5e8c18ee28a8317b098c860ee98786a828c0e04',
    select: (path) => path === 'mod.test.ts',
    registration: /\bDeno\.test\s*\(/g,
  },
  {
    id: 'david-shell',
    directory: 'shell-core',
    repository: 'dsherret/shell',
    commit: 'eba92f9c9fcc58e02a8385097791056fd0d2b7ad',
    select: (path) =>
      path === 'mod.test.ts' ||
      (path.startsWith('src/') && path.endsWith('.test.ts')),
    registration: /\bDeno\.test\s*\(/g,
  },
  {
    id: 'nano-spawn',
    directory: 'nano-spawn',
    repository: 'sindresorhus/nano-spawn',
    commit: 'cc231e2c7b1e434a96f25f907ca2cb2f7c596e90',
    select: (path) =>
      path.startsWith('test/') &&
      path.endsWith('.js') &&
      !/(^|\/)(fixtures?|helpers?)(\/|\.|$)/i.test(path),
    registration: /(?<![\w$.])(?:test|it)(?:\.[A-Za-z_$][\w$]*)*\s*\(/g,
  },
  {
    id: 'actions-exec',
    directory: 'toolkit',
    repository: 'actions/toolkit',
    commit: '193fa46c20fde8b0ed54194bc08b841c78c0776d',
    select: (path) => path === 'packages/exec/__tests__/exec.test.ts',
    registration: /(?<![\w$.])(?:test|it)\s*\(/g,
  },
];

const rustSources = [
  {
    id: 'rust-std-process',
    root: rustRoot,
    directory: 'rust',
    repository: 'rust-lang/rust',
    commit: '24d472027454741e74f8e913755fbc7e03f02af5',
    select: (path) =>
      path === 'library/std/src/process/tests.rs' ||
      /^tests\/ui\/process\/.*\.rs$/.test(path),
    registrationFiles: (path) => path === 'library/std/src/process/tests.rs',
    fileUnitFiles: (path) => path.startsWith('tests/ui/process/'),
  },
  {
    id: 'tokio-process',
    root: rustRoot,
    directory: 'tokio',
    repository: 'tokio-rs/tokio',
    commit: '6276684c288d8e513410219fa2129c69df41af18',
    select: (path) => /^tokio\/tests\/process_.*\.rs$/.test(path),
  },
  {
    id: 'async-process',
    root: rustRoot,
    directory: 'async-process',
    repository: 'smol-rs/async-process',
    commit: 'f4485f156f9294b86a5be37f7236bcf0cf93c76b',
    select: (path) => /^tests\/[^/]+\.rs$/.test(path),
  },
  {
    id: 'assert-cmd',
    root: rustRoot,
    directory: 'assert_cmd',
    repository: 'assert-rs/assert_cmd',
    commit: 'a57ef45a33986390be3057c192c6bdbe61b8912d',
    select: (path) =>
      /^tests\/.*\.rs$/.test(path) &&
      !path.includes('/fixtures/') &&
      !path.includes('/data/'),
  },
  {
    id: 'duct',
    root: rustRoot,
    directory: 'duct',
    repository: 'oconnor663/duct.rs',
    commit: '0195544c9d963d94348e8bc94fc60b8519e5516b',
    select: (path) => path === 'src/test.rs',
  },
  {
    id: 'xshell',
    root: rustRoot,
    directory: 'xshell',
    repository: 'matklad/xshell',
    commit: '52f71bac326aaac291d07146ea790ad886dd8131',
    select: (path) =>
      /^tests\/.*\.rs$/.test(path) && !path.startsWith('tests/data/'),
  },
  {
    id: 'subprocess',
    root: rustRoot,
    directory: 'subprocess',
    repository: 'hniksic/rust-subprocess',
    commit: 'e8cd8d0c930a790ce29373a8c3ee080dd746b9eb',
    select: (path) =>
      /^src\/tests\/.*\.rs$/.test(path) || /^tests\/[^/]+\.rs$/.test(path),
  },
  {
    id: 'rust-cmd-lib',
    root: rustRoot,
    directory: 'cmd_lib',
    repository: 'rust-shell-script/rust_cmd_lib',
    commit: '5a87af574a694fbfd0d4ade0c9b3dadc7cd463f6',
    select: (path) => /^tests\/[^/]+\.rs$/.test(path),
  },
  {
    id: 'run-script',
    root: rustRoot,
    directory: 'run_script',
    repository: 'sagiegurari/run_script',
    commit: 'a79fdf0e15afca84681e5cf104bc080ceec60954',
    select: (path) =>
      /^src\/[^/]+_test\.rs$/.test(path) || /^tests\/[^/]+\.rs$/.test(path),
  },
  {
    id: 'bkt',
    root: rustExtraRoot,
    directory: 'bkt',
    repository: 'dimo414/bkt',
    commit: '76c4d24306bd9679ebc6cbacfdb9934ec9ba3be5',
    select: (path) => path === 'src/lib.rs' || /^tests\/[^/]+\.rs$/.test(path),
  },
  {
    id: 'rust-shell',
    root: rustExtraRoot,
    directory: 'rust-shell',
    repository: 'google/rust-shell',
    commit: '8b1e775b09c133c9bfbfbb9be2e3a2b2f4219682',
    select: (path) =>
      [
        'src/command.rs',
        'src/result.rs',
        'src/shell_command.rs',
        'tests/shell_tests.rs',
      ].includes(path),
  },
  {
    id: 'shellfn',
    root: rustExtraRoot,
    directory: 'shellfn',
    repository: 'synek317/shellfn',
    commit: 'd8e2f39ab6633b388b0f9b47ea62c95dc7ee78ca',
    select: (path) => path === 'tests/tests.rs',
  },
  {
    id: 'rexpect',
    root: rustRoot,
    directory: 'rexpect',
    repository: 'rust-cli/rexpect',
    commit: '4c6a13d3d2c79cd63c8b12821530ec015b34fc71',
    select: (path) =>
      ['src/process.rs', 'src/reader.rs', 'src/session.rs'].includes(path),
  },
  {
    id: 'expectrl',
    root: rustExtraRoot,
    directory: 'expectrl',
    repository: 'zhiburt/expectrl',
    commit: 'a2407de94df0b05dd794f79c57dea7b6f0a86f1f',
    select: (path) =>
      /^tests\/[^/]+\.rs$/.test(path) ||
      path === 'src/process/unix.rs' ||
      path === 'src/session/async_session.rs',
  },
];

const rustRegistration = /^\s*#\[(?:[A-Za-z0-9_]+::)*test(?:\([^\]]*\))?\]/gm;

function labelAfter(source, index, language) {
  const sample = source.slice(index, index + 400);
  const functionName = sample.match(
    language === 'rust'
      ? /(?:fn|async\s+fn)\s+([A-Za-z0-9_]+)/
      : /(?:async\s+)?function\s+([A-Za-z0-9_]+)/
  );
  if (functionName) {
    return functionName[1];
  }
  const quoted = sample.match(/["'`]([^"'`\n]{1,160})["'`]/);
  if (quoted) {
    return quoted[1];
  }
  return functionName?.[1] ?? '';
}

function position(source, index) {
  const before = source.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  return { line, column: index - lastNewline };
}

function loadDecisionLedger(path, language) {
  const records = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const metadata = records.shift();
  if (
    metadata?.record !== 'decisions' ||
    metadata.schemaVersion !== 1 ||
    metadata.language !== language
  ) {
    throw new Error(`Invalid ${language} decision ledger metadata in ${path}`);
  }

  const decisions = new Map();
  for (const record of records) {
    if (
      Object.keys(record).sort().join(',') !== 'disposition,id' ||
      Object.keys(record.disposition ?? {})
        .sort()
        .join(',') !== 'id,kind' ||
      typeof record.id !== 'string' ||
      typeof record.disposition.id !== 'string' ||
      typeof record.disposition.kind !== 'string'
    ) {
      throw new Error(`Invalid explicit decision in ${path}: ${record.id}`);
    }
    if (decisions.has(record.id)) {
      throw new Error(`Duplicate explicit decision in ${path}: ${record.id}`);
    }
    decisions.set(record.id, record.disposition);
  }
  return decisions;
}

function recordsForSource(language, root, source, registration, decisions) {
  const checkout = join(root, source.directory);
  const checkoutCommit = execFileSync(
    'git',
    ['-C', checkout, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' }
  ).trim();
  if (checkoutCommit !== source.commit) {
    throw new Error(
      `${source.id} checkout is ${checkoutCommit}; expected ${source.commit}`
    );
  }
  const files = walk(checkout)
    .map((path) => ({ path, relative: normalizedRelative(checkout, path) }))
    .filter(({ relative: path }) => source.select(path))
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const records = [];

  for (const file of files) {
    const text = readFileSync(file.path, 'utf8');
    const useRegistrations =
      !source.fileUnits &&
      (!source.registrationFiles || source.registrationFiles(file.relative));
    const matches = useRegistrations
      ? [...text.matchAll(source.registration ?? registration)]
      : [];
    const useFileUnit =
      source.fileUnits ||
      source.fileUnitFiles?.(file.relative) ||
      matches.length === 0;
    if (useFileUnit) {
      records.push({ kind: 'file', path: file.relative, index: 0, label: '' });
    }
    for (const match of matches) {
      records.push({
        kind: 'registration',
        path: file.relative,
        index: match.index,
        label: labelAfter(text, match.index, language),
      });
    }
  }

  return {
    source: {
      id: source.id,
      repository: source.repository,
      commit: source.commit,
      sourceFiles: files.length,
      registrationSites: records.filter(({ kind }) => kind === 'registration')
        .length,
    },
    units: records.map((record) => {
      const { line, column } = position(
        readFileSync(join(checkout, record.path), 'utf8'),
        record.index
      );
      const id = `${source.id}:${record.path}:${line}:${column}:${record.kind}`;
      const explicitDecision = decisions.get(id);
      if (!explicitDecision) {
        throw new Error(
          `Unclassified ${language} upstream unit: ${id}. Add a reviewed entry to the decision ledger.`
        );
      }
      return {
        id,
        source: source.id,
        unit: record.kind,
        path: record.path,
        line,
        column,
        label: record.label,
        disposition: explicitDecision,
        url: `https://github.com/${source.repository}/blob/${source.commit}/${record.path}#L${line}`,
      };
    }),
  };
}

function manifest(language, sources, defaultRoot, registration, decisions) {
  const generated = sources.map((source) =>
    recordsForSource(
      language,
      source.root ?? defaultRoot,
      source,
      registration,
      decisions
    )
  );
  const units = generated.flatMap(({ units: sourceUnits }) => sourceUnits);
  const unitIds = new Set(units.map(({ id }) => id));
  const staleDecisions = [...decisions.keys()].filter((id) => !unitIds.has(id));
  if (staleDecisions.length > 0) {
    throw new Error(
      `Stale ${language} decisions are not present upstream:\n${staleDecisions.join('\n')}`
    );
  }
  return {
    schemaVersion: 1,
    snapshotDate: '2026-09-13',
    language,
    sources: generated.map(({ source }) => source),
    units,
  };
}

const jsDecisions = loadDecisionLedger(jsDecisionPath, 'js');
const rustDecisions = loadDecisionLedger(rustDecisionPath, 'rust');
const jsManifest = manifest('js', jsSources, jsRoot, undefined, jsDecisions);
const rustManifest = manifest(
  'rust',
  rustSources,
  rustRoot,
  rustRegistration,
  rustDecisions
);

function serializeManifest(output) {
  const metadata = {
    record: 'manifest',
    schemaVersion: output.schemaVersion,
    snapshotDate: output.snapshotDate,
    language: output.language,
  };
  return `${[
    metadata,
    ...output.sources.map((source) => ({ record: 'source', ...source })),
    ...output.units.map((unit) => ({ record: 'unit', ...unit })),
  ]
    .map((record) => JSON.stringify(record))
    .join('\n')}\n`;
}

writeFileSync(
  join(import.meta.dirname, '../tests/competitor-dispositions.jsonl'),
  serializeManifest(jsManifest)
);
writeFileSync(
  join(import.meta.dirname, '../../rust/tests/competitor_dispositions.jsonl'),
  serializeManifest(rustManifest)
);

for (const output of [jsManifest, rustManifest]) {
  const registrations = output.sources.reduce(
    (sum, source) => sum + source.registrationSites,
    0
  );
  console.log(
    `${output.language}: ${output.sources.length} sources, ${output.units.length} units, ${registrations} registrations`
  );
}
