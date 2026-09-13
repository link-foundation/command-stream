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
import { $, exec, ProcessRunner } from '../src/$.mjs';
import {
  competitors,
  excludedTestClasses,
  missingFeatures,
  pinnedSourceUrl,
  portedCases,
  snapshotDate,
} from './competitor-corpus.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = join(testDirectory, '..');
const fixturePath = join(testDirectory, 'fixtures', 'competitor-process.mjs');
const auditPath = join(packageDirectory, 'docs', 'COMPETITOR_TEST_AUDIT.md');
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
    expect(competitors.length).toBe(10);
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
      const dangerous = "'; echo injected; echo '$HOME $(uname) *";
      const result = await $({
        capture: true,
        mirror: false,
        stdin: 'ignore',
      })`${process.execPath} ${fixturePath} argv ${dangerous}`;

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([dangerous]);
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
      expect(realpathSync(result.stdout)).toBe(realpathSync(directory));
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
    'captures stdout and stderr independently',
    async () => {
      const result = await runFixture('stdio', ['out\n', 'err\n']);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('out\n');
      expect(result.stderr).toBe('err\n');
    }
  );

  port(
    'newline-preservation',
    'does not strip final or repeated newlines',
    async () => {
      const output = 'first\n\nlast\n';
      const result = await runFixture('stdio', [output, '']);

      expect(result.stdout).toBe(output);
    }
  );

  port(
    'unicode-output',
    'decodes split-compatible Unicode output without loss',
    async () => {
      const output = 'こんにちは — héllø — ☃\n';
      const result = await runFixture('stdio', [output, '']);

      expect(result.stdout).toBe(output);
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
    expect(result.stdout).toBe(input);
    expect(result.stdin).toBe(input);
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

      expect(alpha.stdout).toBe('alpha-done');
      expect(beta.stdout).toBe('beta-done');
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
      expect(result.stdout).toBe('firstsecond');
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
        stdout: result.stdout,
        stderr: result.stderr,
      });
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
      expect(result.stdout).toBe('piped input');
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
