#!/usr/bin/env node

// Convert an authenticated GitHub search capture into the immutable candidate
// ledger used by both language audits. The refresh command is documented next
// to the generated JSON file.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const inputIndex = process.argv.indexOf('--input');
if (inputIndex === -1 || !process.argv[inputIndex + 1]) {
  throw new Error('Usage: capture-competitor-discovery.mjs --input FILE');
}

const queries = [
  {
    language: 'javascript',
    query:
      'child process in:name,description,topics language:JavaScript stars:>=500',
  },
  {
    language: 'javascript',
    query:
      'child process in:name,description,topics language:TypeScript stars:>=500',
  },
  {
    language: 'javascript',
    query:
      'shell command in:name,description,topics language:JavaScript stars:>=500',
  },
  {
    language: 'javascript',
    query:
      'shell command in:name,description,topics language:TypeScript stars:>=500',
  },
  {
    language: 'rust',
    query:
      'process execution in:name,description,topics language:Rust stars:>=100',
  },
  {
    language: 'rust',
    query: 'shell command in:name,description,topics language:Rust stars:>=100',
  },
];

const selected = new Set([
  'nodejs/node',
  'oven-sh/bun',
  'denoland/deno',
  'sindresorhus/execa',
  'google/zx',
  'shelljs/shelljs',
  'moxystudio/node-cross-spawn',
  'dsherret/dax',
  'dsherret/shell',
  'sindresorhus/nano-spawn',
  'actions/toolkit',
  'rust-lang/rust',
  'tokio-rs/tokio',
  'smol-rs/async-process',
  'assert-rs/assert_cmd',
  'oconnor663/duct.rs',
  'matklad/xshell',
  'hniksic/rust-subprocess',
  'rust-shell-script/rust_cmd_lib',
  'sagiegurari/run_script',
  'dimo414/bkt',
  'google/rust-shell',
  'synek317/shellfn',
  'rust-cli/rexpect',
  'zhiburt/expectrl',
]);

const seeds = [
  ['javascript', 'nodejs/node', 121848, false, 'native runtime primitive'],
  ['javascript', 'oven-sh/bun', 95955, false, 'native runtime primitive'],
  ['javascript', 'denoland/deno', 108420, false, 'native runtime primitive'],
  ['javascript', 'sindresorhus/execa', 7602, false, 'ecosystem nomination'],
  ['javascript', 'google/zx', 45743, false, 'ecosystem nomination'],
  [
    'javascript',
    'moxystudio/node-cross-spawn',
    1171,
    false,
    'ecosystem nomination',
  ],
  ['javascript', 'dsherret/dax', 1496, false, 'ecosystem nomination'],
  ['javascript', 'dsherret/shell', 7, false, 'selected Dax command engine'],
  [
    'javascript',
    'actions/toolkit',
    5847,
    false,
    'distinct @actions/exec package',
  ],
  [
    'javascript',
    'extrabacon/python-shell',
    2161,
    false,
    'ecosystem nomination',
  ],
  [
    'javascript',
    'open-cli-tools/concurrently',
    7847,
    false,
    'ecosystem nomination',
  ],
  ['javascript', 'shelljs/shx', 1871, false, 'ecosystem nomination'],
  ['javascript', 'pstadler/flightplan', 1812, false, 'ecosystem nomination'],
  ['javascript', 'ehmicky/nve', 711, false, 'ecosystem nomination'],
  ['rust', 'rust-lang/rust', 118804, false, 'native primitive'],
  ['rust', 'tokio-rs/tokio', 33143, false, 'general async runtime primitive'],
  ['rust', 'smol-rs/async-process', 216, false, 'ecosystem nomination'],
  ['rust', 'assert-rs/assert_cmd', 562, false, 'ecosystem nomination'],
  ['rust', 'oconnor663/duct.rs', 1043, false, 'ecosystem nomination'],
  ['rust', 'matklad/xshell', 834, false, 'ecosystem nomination'],
  ['rust', 'hniksic/rust-subprocess', 452, false, 'ecosystem nomination'],
  [
    'rust',
    'rust-shell-script/rust_cmd_lib',
    1155,
    false,
    'ecosystem nomination',
  ],
  ['rust', 'sagiegurari/run_script', 131, false, 'ecosystem nomination'],
  ['rust', 'dimo414/bkt', 358, false, 'ecosystem nomination'],
  ['rust', 'google/rust-shell', 224, true, 'ecosystem nomination'],
  ['rust', 'synek317/shellfn', 220, false, 'ecosystem nomination'],
  ['rust', 'rust-cli/rexpect', 392, false, 'ecosystem nomination'],
  ['rust', 'zhiburt/expectrl', 215, false, 'ecosystem nomination'],
  ['rust', 'dtolnay/faketty', 208, false, 'ecosystem nomination'],
  ['rust', 'rash-sh/rash', 254, false, 'ecosystem nomination'],
  ['rust', 'watchexec/watchexec', 7181, false, 'ecosystem nomination'],
  ['rust', 'Nukesor/pueue', 6330, false, 'ecosystem nomination'],
  ['rust', 'denoland/deno_task_shell', 139, false, 'ecosystem nomination'],
];

const explicitRejections = new Map([
  ['extrabacon/python-shell', 'bridge limited to one guest language'],
  ['open-cli-tools/concurrently', 'task orchestrator CLI'],
  ['sindresorhus/grunt-shell', 'task-runner plugin'],
  ['shelljs/shx', 'standalone CLI over the selected ShellJS library'],
  ['pstadler/flightplan', 'deployment task orchestrator'],
  [
    'ehmicky/nve',
    'Node-version launcher rather than a general process library',
  ],
  ['dtolnay/faketty', 'standalone PTY wrapper CLI'],
  ['rash-sh/rash', 'task/configuration orchestrator'],
  ['watchexec/watchexec', 'file-watcher task orchestrator'],
  ['Nukesor/pueue', 'task manager application'],
  [
    'denoland/deno_task_shell',
    'task-shell implementation, not a general library API',
  ],
]);

function decision(repository) {
  if (selected.has(repository)) {
    return { status: 'included' };
  }
  return {
    status: 'excluded',
    reason:
      explicitRejections.get(repository) ??
      'search hit is not a general-purpose command/process execution library',
  };
}

const lines = readFileSync(process.argv[inputIndex + 1], 'utf8')
  .trim()
  .split('\n');
const captures = [];
let cursor = 0;
for (const query of queries) {
  const header = lines[cursor++]?.match(/^QUERY (\d+)$/);
  if (!header) {
    throw new Error(`Missing result header for ${query.query}`);
  }
  const count = Number(header[1]);
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const [repository, stars, archived, description] =
      lines[cursor++].split('\t');
    results.push({
      repository,
      stars: Number(stars),
      archived: archived === 'true',
      description,
    });
  }
  captures.push({ ...query, totalCount: count, results });
}
if (cursor !== lines.length) {
  throw new Error('Unexpected trailing search results');
}

const candidates = new Map();
for (const capture of captures) {
  for (const result of capture.results) {
    const key = `${capture.language}:${result.repository}`;
    candidates.set(key, {
      language: capture.language,
      ...result,
      origins: [
        ...(candidates.get(key)?.origins ?? []),
        `github-search:${captures.indexOf(capture) + 1}`,
      ],
      ...decision(result.repository),
    });
  }
}
for (const [language, repository, stars, archived, origin] of seeds) {
  const key = `${language}:${repository}`;
  const previous = candidates.get(key);
  candidates.set(key, {
    language,
    repository,
    stars,
    archived,
    description: previous?.description ?? '',
    origins: [...(previous?.origins ?? []), origin],
    ...decision(repository),
  });
}

const snapshot = {
  schemaVersion: 1,
  snapshotDate: '2026-09-13',
  githubApi:
    'GET /search/repositories?per_page=100&q=<query> (authenticated, complete because every totalCount is below 100)',
  queries: captures,
  candidates: [...candidates.values()].sort((left, right) =>
    `${left.language}:${left.repository}`.localeCompare(
      `${right.language}:${right.repository}`
    )
  ),
};

writeFileSync(
  join(import.meta.dirname, '../../docs/COMPETITOR_DISCOVERY.json'),
  `${JSON.stringify(snapshot, null, 2)}\n`
);
