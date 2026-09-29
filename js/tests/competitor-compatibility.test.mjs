import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './test-helper.mjs';
import { $, exec, ProcessRunner, shell } from '../src/$.mjs';
import {
  competitors,
  excludedTestClasses,
  missingFeatures,
  pinnedSourceUrl,
  portedCases,
  snapshotDate,
} from './competitor-corpus.mjs';
import { COMPLEX_MARKDOWN_BODY } from './fixtures/complex-markdown-body.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = join(testDirectory, '..');
const fixturePath = join(testDirectory, 'fixtures', 'competitor-process.mjs');
const auditPath = join(packageDirectory, 'docs', 'COMPETITOR_TEST_AUDIT.md');
const dispositionPath = join(testDirectory, 'competitor-dispositions.jsonl');
const decisionPath = join(testDirectory, 'competitor-decisions.jsonl');
const discoveryPath = join(
  packageDirectory,
  '..',
  'docs',
  'COMPETITOR_DISCOVERY.json'
);
const temporaryDirectories = [];
const executedCaseIds = new Set();

function fixtureRunner(mode, args = [], options = {}) {
  return new ProcessRunner(
    {
      mode: 'exec',
      file: process.execPath,
      args: [fixturePath, mode, ...args],
    },
    { capture: true, mirror: false, stdin: 'ignore', ...options }
  );
}

function runFixture(mode, args = [], options = {}) {
  return fixtureRunner(mode, args, options).start();
}

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'command-stream-corpus-'));
  temporaryDirectories.push(directory);
  return directory;
}

function readDispositionManifest() {
  const records = readFileSync(dispositionPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const [metadata] = records;
  const withoutRecordType = ({ record: _, ...value }) => value;
  return {
    ...withoutRecordType(metadata),
    recordType: metadata.record,
    recordCount: records.length,
    sources: records
      .filter(({ record }) => record === 'source')
      .map(withoutRecordType),
    units: records
      .filter(({ record }) => record === 'unit')
      .map(withoutRecordType),
  };
}

function readDecisionLedger() {
  const records = readFileSync(decisionPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  return { metadata: records[0], decisions: records.slice(1) };
}

function port(id, title, implementation, timeout) {
  if (!portedCases.some((entry) => entry.id === id)) {
    throw new Error(`Unregistered competitor case: ${id}`);
  }
  if (executedCaseIds.has(id)) {
    throw new Error(`Duplicate competitor case: ${id}`);
  }
  executedCaseIds.add(id);
  test(`[${id}] ${title}`, implementation, timeout);
}

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('competitor corpus integrity', () => {
  test('pins a unique, immutable upstream inventory', () => {
    expect(snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(competitors.length).toBe(12);
    expect(competitors.reduce((sum, item) => sum + item.sourceFiles, 0)).toBe(
      416
    );
    expect(
      competitors.reduce((sum, item) => sum + (item.registrationSites ?? 0), 0)
    ).toBe(7382);
    expect(new Set(competitors.map(({ id }) => id)).size).toBe(
      competitors.length
    );

    for (const competitor of competitors) {
      expect(competitor.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(competitor.repository).toMatch(/^[^/]+\/[^/]+$/);
      expect(competitor.sourceFiles).toBeGreaterThan(0);
      expect(competitor.scope.length).toBeGreaterThan(0);
      expect(pinnedSourceUrl(competitor, competitor.scope[0])).toContain(
        competitor.commit
      );
    }
  });

  test('assigns every pinned upstream unit exactly one disposition', () => {
    const manifest = readDispositionManifest();
    const knownCompetitors = new Map(
      competitors.map((competitor) => [competitor.id, competitor])
    );
    const knownDispositions = new Set([
      ...portedCases.map(({ id }) => `ported:${id}`),
      ...missingFeatures.map(({ id }) => `missing:${id}`),
      ...excludedTestClasses.map(({ id }) => `inapplicable:${id}`),
    ]);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.recordType).toBe('manifest');
    expect(manifest.recordCount).toBe(7528);
    expect(manifest.snapshotDate).toBe(snapshotDate);
    expect(manifest.language).toBe('js');
    expect(manifest.sources).toEqual(
      competitors.map(
        ({ id, repository, commit, sourceFiles, registrationSites }) => ({
          id,
          repository,
          commit,
          sourceFiles,
          registrationSites: registrationSites ?? 0,
        })
      )
    );
    expect(manifest.units.length).toBe(7515);
    expect(new Set(manifest.units.map(({ id }) => id)).size).toBe(
      manifest.units.length
    );

    for (const source of manifest.sources) {
      const units = manifest.units.filter(({ source: id }) => id === source.id);
      expect(new Set(units.map(({ path }) => path)).size).toBe(
        source.sourceFiles
      );
      expect(units.filter(({ unit }) => unit === 'registration').length).toBe(
        source.registrationSites
      );
    }

    for (const unit of manifest.units) {
      const competitor = knownCompetitors.get(unit.source);
      expect(competitor).toBeDefined();
      expect(unit.id).toBe(
        `${unit.source}:${unit.path}:${unit.line}:${unit.column}:${unit.unit}`
      );
      expect(Object.keys(unit.disposition).sort()).toEqual(['id', 'kind']);
      expect(unit).toHaveProperty('disposition.kind');
      expect(unit).toHaveProperty('disposition.id');
      expect(
        knownDispositions.has(`${unit.disposition.kind}:${unit.disposition.id}`)
      ).toBe(true);
      expect(unit.url).toBe(
        `${pinnedSourceUrl(competitor, unit.path)}#L${unit.line}`
      );
    }
  });

  test('keeps every generated disposition backed by an explicit reviewed decision', () => {
    const manifest = readDispositionManifest();
    const { metadata, decisions } = readDecisionLedger();
    const manifestDecisions = new Map(
      manifest.units.map(({ id, disposition }) => [id, disposition])
    );

    expect(metadata).toEqual({
      record: 'decisions',
      schemaVersion: 1,
      language: 'js',
    });
    expect(decisions).toHaveLength(7515);
    expect(new Set(decisions.map(({ id }) => id)).size).toBe(decisions.length);
    expect(decisions.map(({ id }) => id).sort()).toEqual(
      [...manifestDecisions.keys()].sort()
    );
    expect(
      decisions.filter(
        ({ disposition }) =>
          disposition.kind === 'inapplicable' &&
          disposition.id === 'competitor-api-shape'
      )
    ).toHaveLength(70);
    for (const { id, disposition } of decisions) {
      expect(disposition).toEqual(manifestDecisions.get(id));
    }

    expect(
      manifestDecisions.get(
        'node-child-process:test/parallel/test-child-process-exec-maxbuf.js:1:1:file'
      )
    ).toEqual({ kind: 'missing', id: 'max-buffer-policy' });
    expect(
      manifestDecisions.get(
        'cross-env:src/__tests__/command-default-values.test.ts:16:2:registration'
      )
    ).toEqual({
      kind: 'missing',
      id: 'cross-platform-inline-environment-syntax',
    });
    expect(
      manifestDecisions.get(
        'cross-spawn:test/index.test.js:377:13:registration'
      )
    ).toEqual({ kind: 'ported', id: 'spawn-error-result' });
    expect(
      manifestDecisions.get(
        'cross-spawn:test/index.test.js:387:13:registration'
      )
    ).toEqual({ kind: 'ported', id: 'spawn-error-result' });
  });

  test('accounts for every selected project and every ported case', () => {
    const knownCompetitors = new Set(competitors.map(({ id }) => id));
    const referencedCompetitors = new Set(
      [...portedCases, ...missingFeatures].flatMap(
        ({ competitors: projects }) => projects
      )
    );

    expect([...referencedCompetitors].sort()).toEqual(
      [...knownCompetitors].sort()
    );
    expect([...executedCaseIds].sort()).toEqual(
      portedCases.map(({ id }) => id).sort()
    );
    expect(new Set(portedCases.map(({ id }) => id)).size).toBe(
      portedCases.length
    );
    expect(excludedTestClasses.length).toBeGreaterThan(0);
  });

  test('keeps exact discovery inputs and a complete candidate ledger', () => {
    const discovery = JSON.parse(readFileSync(discoveryPath, 'utf8'));
    const candidates = discovery.candidates.filter(
      ({ language }) => language === 'javascript'
    );
    const included = candidates
      .filter(({ status }) => status === 'included')
      .map(({ repository }) => repository)
      .sort();

    expect(discovery.snapshotDate).toBe(snapshotDate);
    expect(discovery.queries).toHaveLength(9);
    expect(
      new Set(
        discovery.candidates.map(
          ({ language, repository }) => `${language}:${repository}`
        )
      ).size
    ).toBe(discovery.candidates.length);
    for (const query of discovery.queries) {
      expect(query.results).toHaveLength(query.totalCount);
      for (const result of query.results) {
        expect(
          discovery.candidates.some(
            ({ language, repository }) =>
              language === query.language && repository === result.repository
          )
        ).toBe(true);
      }
    }
    expect(
      candidates.every(
        ({ status }) => status === 'included' || status === 'excluded'
      )
    ).toBe(true);
    expect(
      candidates
        .filter(({ status }) => status === 'excluded')
        .every(({ reason }) => typeof reason === 'string' && reason.length > 0)
    ).toBe(true);
    expect(included).toEqual(
      competitors.map(({ repository }) => repository).sort()
    );
    for (const competitor of competitors) {
      const candidate = candidates.find(
        ({ repository }) => repository === competitor.repository
      );
      expect(candidate).toBeDefined();
      expect(candidate.stars).toBe(competitor.stars);
    }
  });

  test('keeps every unsupported feature in the markdown ledger', () => {
    const audit = readFileSync(auditPath, 'utf8');

    for (const competitor of competitors) {
      expect(audit).toContain(competitor.commit);
    }
    for (const feature of missingFeatures) {
      expect(audit).toContain(`### ${feature.id}`);
    }
  });

  test('contains no conceptual always-passing feature assertions', () => {
    const featureFiles = readdirSync(testDirectory).filter((name) =>
      name.endsWith('.features.test.mjs')
    );

    for (const featureFile of featureFiles) {
      const source = readFileSync(join(testDirectory, featureFile), 'utf8');
      expect(source).not.toContain('expect(true).toBe(true)');
    }
  });
});

describe('ported public process behavior', () => {
  port(
    'direct-exact-argv',
    'passes an argument vector without shell parsing',
    async () => {
      const expected = ['plain', 'two words', '--flag=value', 'trailing\\'];
      const result = await runFixture('argv', expected);

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(expected);
    }
  );

  port(
    'argument-edge-cases',
    'preserves empty, multiline, Unicode, and metacharacter arguments',
    async () => {
      const expected = [
        '',
        ' ',
        'line one\nline two',
        'tab\tvalue',
        'Iñtërnâtiônàlizætiøn☃',
        '"double" and \'single\'',
        '$HOME',
        '$(echo injected)',
        '&&',
        '|',
        ';',
        '*',
        '?',
        COMPLEX_MARKDOWN_BODY,
      ];
      const result = await runFixture('argv', expected);

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(expected);
    }
  );

  port(
    'safe-template-interpolation',
    'quotes untrusted template values as one literal argument',
    async () => {
      const values = [
        "'; echo injected; echo '$HOME $(uname) *",
        COMPLEX_MARKDOWN_BODY,
      ];

      for (const value of values) {
        const result = await $({
          capture: true,
          mirror: false,
          stdin: 'ignore',
        })`${process.execPath} ${fixturePath} argv ${value}`;

        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual([value]);
      }
    }
  );

  port(
    'array-interpolation',
    'expands an interpolated array to distinct arguments',
    async () => {
      const values = ['one', 'two words', '', '$HOME', 'Iñtërnâtiônàlizætiøn☃'];
      const result = await $({
        capture: true,
        mirror: false,
        stdin: 'ignore',
      })`${process.execPath} ${fixturePath} argv ${values}`;

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(values);
    }
  );

  port(
    'cwd-string',
    'starts a process in the requested working directory',
    async () => {
      const directory = temporaryDirectory();
      const result = await runFixture('cwd', [], { cwd: directory });

      expect(result.code).toBe(0);
      expect(realpathSync(result.stdout.toString())).toBe(
        realpathSync(directory)
      );
    }
  );

  port(
    'environment',
    'passes an explicit environment to the child',
    async () => {
      const env = {
        ...process.env,
        COMMAND_STREAM_CORPUS_ALPHA: 'one',
        COMMAND_STREAM_CORPUS_UNICODE: 'héllø☃',
      };
      const result = await runFixture(
        'env',
        ['COMMAND_STREAM_CORPUS_ALPHA', 'COMMAND_STREAM_CORPUS_UNICODE'],
        { env }
      );

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        COMMAND_STREAM_CORPUS_ALPHA: 'one',
        COMMAND_STREAM_CORPUS_UNICODE: 'héllø☃',
      });
    }
  );

  port(
    'stdout-stderr-separation',
    'captures stdout-only, stderr-only, and mixed output independently',
    async () => {
      const cases = [
        { stdout: 'out\n', stderr: 'err\n' },
        { stdout: 'out-only\n', stderr: '' },
        // A successful CLI may use stderr for machine-readable output. gh pr
        // create was reported to do this for its URL in issue #47.
        {
          stdout: '',
          stderr: 'https://github.com/octo/example/pull/123\n',
        },
      ];

      for (const expected of cases) {
        const result = await runFixture('stdio', [
          expected.stdout,
          expected.stderr,
        ]);

        expect(result.code).toBe(0);
        expect(result.stdout?.toString()).toBe(expected.stdout);
        expect(result.stderr?.toString()).toBe(expected.stderr);
      }
    }
  );

  port(
    'newline-preservation',
    'does not strip final or repeated newlines',
    async () => {
      const output = 'first\n\nlast\n';
      const result = await runFixture('stdio', [output, '']);

      expect(result.stdout?.toString()).toBe(output);
    }
  );

  port(
    'unicode-output',
    'decodes split-compatible Unicode output without loss',
    async () => {
      const output = 'こんにちは — héllø — ☃\n';
      const result = await runFixture('stdio', [output, '']);

      expect(result.stdout?.toString()).toBe(output);
    }
  );

  port(
    'large-output',
    'captures output larger than common default buffers without truncation',
    async () => {
      const size = 1024 * 1024;
      const result = await runFixture('output', [String(size), 'x']);

      expect(result.code).toBe(0);
      expect(result.stdout.length).toBe(size);
      expect(result.stdout.at(0)).toBe('x');
      expect(result.stdout.at(-1)).toBe('x');
    }
  );

  port(
    'nonzero-exit',
    'returns the child exit status through both aliases',
    async () => {
      const result = await runFixture('exit', ['42']);

      expect(result.code).toBe(42);
      expect(result.exitCode).toBe(42);

      // Execa, zx, nano-spawn and the Bun shell reject a failing command with
      // an error that names the status `exitCode`, while Node.js names it
      // `code`. In errexit mode command-stream answers to both (issue #38).
      shell.errexit(true);
      try {
        const error = await runFixture('exit', ['42']).catch(
          (thrown) => thrown
        );

        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe(42);
        expect(error.exitCode).toBe(42);
        expect(error.result.code).toBe(42);
        expect(error.result.exitCode).toBe(42);
      } finally {
        shell.errexit(false);
      }
    }
  );

  port('result-text', 'exposes captured stdout through text()', async () => {
    const result = await runFixture('stdio', ['result text', '']);

    expect(await result.text()).toBe('result text');
  });

  port('stdin-string', 'writes string input and closes stdin', async () => {
    const input = 'first\nsecond\n';
    const result = await runFixture('stdin', [], { stdin: input });

    expect(result.code).toBe(0);
    expect(result.stdout?.toString()).toBe(input);
    expect(result.stdin?.toString()).toBe(input);
  });

  port(
    'stdin-buffer',
    'writes binary Buffer input without string coercion',
    async () => {
      const input = Buffer.from([0, 1, 2, 10, 13, 127]);
      const result = await runFixture('stdin', [], { stdin: input });

      expect(result.code).toBe(0);
      expect(Buffer.from(result.stdout, 'latin1')).toEqual(input);
    }
  );

  port(
    'lazy-execution',
    'does not spawn a ProcessRunner before it is consumed',
    async () => {
      const marker = join(temporaryDirectory(), 'started.txt');
      const runner = fixtureRunner('touch', [marker]);

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(runner.started).toBe(false);
      expect(existsSync(marker)).toBe(false);

      const result = await runner;
      expect(result.code).toBe(0);
      expect(readFileSync(marker, 'utf8')).toBe('started');
    }
  );

  port(
    'concurrent-execution',
    'keeps concurrent process results isolated',
    async () => {
      const [alpha, beta] = await Promise.all([
        runFixture('delayed', ['alpha-', 'done', '40']),
        runFixture('delayed', ['beta-', 'done', '20']),
      ]);

      expect(alpha.stdout?.toString()).toBe('alpha-done');
      expect(beta.stdout?.toString()).toBe('beta-done');
    }
  );

  port(
    'streamed-before-exit',
    'emits output while the child is still running',
    async () => {
      const runner = fixtureRunner('delayed', ['first', 'second', '100']);
      const firstChunk = new Promise((resolve) => {
        runner.on('stdout', (chunk) => resolve(chunk.toString()));
      });
      const completion = runner.start();

      expect(await firstChunk).toBe('first');
      expect(runner.finished).toBe(false);

      const result = await completion;
      expect(result.stdout?.toString()).toBe('firstsecond');
    }
  );

  port(
    'events-and-await',
    'delivers the same data through events and the awaited result',
    async () => {
      const runner = fixtureRunner('stdio', ['event-out', 'event-err']);
      const eventOutput = { stdout: '', stderr: '' };
      runner.on('data', ({ type, data }) => {
        eventOutput[type] += data.toString();
      });

      const result = await runner;
      expect(eventOutput).toEqual({
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      });
    }
  );

  port(
    'bound-options',
    'applies options bound to a tagged command',
    async () => {
      const variable = 'COMMAND_STREAM_BOUND_OPTION';
      const bound = $({
        capture: true,
        env: { ...process.env, [variable]: 'bound-value' },
        mirror: false,
      });
      const result =
        await bound`${process.execPath} ${fixturePath} env ${variable}`;

      expect(JSON.parse(result.stdout)).toEqual({ [variable]: 'bound-value' });
    }
  );

  port(
    'sync-execution',
    'supports the same exact-argv contract synchronously',
    () => {
      const expected = ['sync', 'two words', '', '$HOME'];
      const result = fixtureRunner('argv', expected).sync();

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(expected);
    }
  );

  port(
    'programmatic-pipeline',
    'pipes one process stdout into another process stdin',
    async () => {
      const source = fixtureRunner('stdio', ['piped input', '']);
      const destination = fixtureRunner('stdin', [], { stdin: 'pipe' });
      const result = await source.pipe(destination);

      expect(result.code).toBe(0);
      expect(result.stdout?.toString()).toBe('piped input');
    }
  );

  port(
    'spawn-error-result',
    'reports an unavailable executable without rejecting',
    async () => {
      const missingExecutable = join(
        temporaryDirectory(),
        'command-stream-does-not-exist'
      );
      const result = await exec(missingExecutable, [], {
        capture: true,
        mirror: false,
        stdin: 'ignore',
      });

      expect(result.code).toBe(127);
      expect(result.exitCode).toBe(127);
      expect(result.stderr.length).toBeGreaterThan(0);

      const syncResult = new ProcessRunner(
        { mode: 'exec', file: missingExecutable, args: [] },
        { capture: true, mirror: false, stdin: 'ignore' }
      ).sync();

      expect(syncResult.code).toBe(127);
      expect(syncResult.exitCode).toBe(127);
      expect(syncResult.stderr.length).toBeGreaterThan(0);
    }
  );

  port(
    'abort-signal',
    'terminates a running process from an AbortSignal',
    async () => {
      const controller = new AbortController();
      const runner = fixtureRunner('delayed', ['started', 'finished', '5000'], {
        signal: controller.signal,
      });
      const started = new Promise((resolve) => runner.on('stdout', resolve));
      const completion = runner.start();

      await started;
      controller.abort();
      const result = await completion;

      expect(result.code).not.toBe(0);
      expect(result.exitCode).toBe(result.code);
    },
    3000
  );
});
