// Guards the release versioning step fixed for issue #216.
//
// Changesets 3 formats the generated CHANGELOG.md with an auto-detected
// formatter. Detection prefers Deno over Prettier, and any deno.json selects it
// even without an `fmt` key, so the js/deno.json used for `deno test` made the
// release job spawn a `deno` binary that the hosted runner does not have:
// `changeset version` failed with `spawn deno ENOENT` after every merge.
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const packageDir = resolve(import.meta.dir, '..');
const config = JSON.parse(
  readFileSync(join(packageDir, '.changeset/config.json'), 'utf8')
);

// The formatters the release job can run: Prettier is a devDependency, and
// `false` runs nothing. Anything else would need a tool the runner lacks.
const RUNNABLE_FORMATTERS = ['prettier', false];

const isWindows = process.platform === 'win32';

describe('changeset config', () => {
  test('pins a formatter the release job can run', () => {
    // `auto` (the default when unset) would pick Deno because of js/deno.json.
    expect(existsSync(join(packageDir, 'deno.json'))).toBe(true);
    expect(RUNNABLE_FORMATTERS).toContain(config.format);
  });

  test('references the schema of the installed @changesets/config', () => {
    const { version } = JSON.parse(
      readFileSync(
        join(packageDir, 'node_modules/@changesets/config/package.json'),
        'utf8'
      )
    );
    expect(config.$schema).toBe(
      `https://unpkg.com/@changesets/config@${version}/schema.json`
    );
  });

  // Runs the real `changeset version` against a copy of the package, with
  // `deno` removed from PATH the way it is absent on the hosted runner.
  test.skipIf(isWindows)(
    'changeset version succeeds without deno on PATH',
    () => {
      const cwd = mkdtempSync(join(tmpdir(), 'changeset-version-'));
      try {
        for (const file of ['package.json', 'deno.json', 'bun.lock']) {
          copyFileSync(join(packageDir, file), join(cwd, file));
        }
        mkdirSync(join(cwd, '.changeset'));
        copyFileSync(
          join(packageDir, '.changeset/config.json'),
          join(cwd, '.changeset/config.json')
        );
        writeFileSync(
          join(cwd, '.changeset/release-check.md'),
          '---\n"command-stream": patch\n---\n\nCheck the release versioning step.\n'
        );
        writeFileSync(join(cwd, 'CHANGELOG.md'), '# command-stream\n');
        symlinkSync(
          join(packageDir, 'node_modules'),
          join(cwd, 'node_modules')
        );

        const PATH = (process.env.PATH ?? '')
          .split(delimiter)
          .filter((dir) => {
            try {
              accessSync(join(dir, 'deno'), constants.X_OK);
              return false;
            } catch {
              return true;
            }
          })
          .join(delimiter);

        const result = spawnSync(
          join(cwd, 'node_modules/.bin/changeset'),
          ['version'],
          { cwd, env: { ...process.env, PATH }, encoding: 'utf8' }
        );

        // Changesets reports the spawn failure on stdout, not stderr.
        expect(`${result.stdout}${result.stderr}`).not.toContain('ENOENT');
        expect(result.status).toBe(0);
        expect(existsSync(join(cwd, '.changeset/release-check.md'))).toBe(
          false
        );
        expect(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8')).toContain(
          'Check the release versioning step.'
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    60000
  );
});
