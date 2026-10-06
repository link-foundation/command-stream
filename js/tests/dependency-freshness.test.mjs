import { describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectDependencies,
  collectToolDependencies,
  checkDependencies,
} from '../../scripts/check-dependencies.mjs';

const dependency = (version, extra = {}) => ({
  ecosystem: 'cargo',
  name: 'nix',
  version,
  file: 'rust/Cargo.toml',
  line: 4,
  ...extra,
});

describe('Rust lockfile freshness workflow', () => {
  for (const update of ['', 'Updating', 'Adding', 'Removing', 'Downgrading']) {
    test.skipIf(process.platform === 'win32')(
      `checks both manifests without ripgrep: ${update || 'current'}`,
      () => {
        const root = mkdtempSync(join(tmpdir(), 'lockfile-freshness-'));
        try {
          const bin = join(root, 'bin');
          mkdirSync(bin);
          for (const tool of ['mkdir', 'tr', 'tee', 'grep']) {
            symlinkSync(
              execFileSync('which', [tool], { encoding: 'utf8' }).trim(),
              join(bin, tool)
            );
          }
          const cargo = join(bin, 'cargo');
          writeFileSync(
            cargo,
            '#!/bin/bash\n' +
              'if [[ "$*" == *rust/benchmarks/Cargo.toml* && -n "$MOCK_UPDATE" ]]; then\n' +
              '  if [[ "$CARGO_TERM_COLOR" == always ]]; then printf "\\033[1m"; fi\n' +
              '  printf "    %s example v1.0.0 -> v1.0.1\\n" "$MOCK_UPDATE"\n' +
              'else\n  printf "    Updating crates.io index\\n     Locking 0 packages to highest compatible versions\\n"\nfi\n'
          );
          chmodSync(cargo, 0o755);
          const workflow = readFileSync(
            new URL(
              '../../.github/workflows/dependencies.yml',
              import.meta.url
            ),
            'utf8'
          );
          const script = workflow
            .split(
              'name: Check Rust lockfiles have no compatible updates pending\n'
            )[1]
            .split('run: |\n')[1]
            .split('\n')
            .map((line) => line.slice(10))
            .join('\n');
          const result = spawnSync('/bin/bash', ['-c', script], {
            cwd: root,
            env: {
              ...process.env,
              PATH: bin,
              CARGO_TERM_COLOR: 'always',
              MOCK_UPDATE: update,
            },
            encoding: 'utf8',
            timeout: 10_000,
          });
          expect(result.error).toBeUndefined();
          expect(result.status).toBe(update ? 1 : 0);
          expect(result.stderr).not.toContain('command not found');
          if (update) {
            expect(result.stdout).toContain(
              'rust/benchmarks/Cargo.toml has pending lockfile updates'
            );
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    );
  }
});

const registry =
  (latest, issueState = 'open') =>
  async (url) =>
    new URL(url).hostname === 'api.github.com'
      ? { state: issueState }
      : { crate: { max_stable_version: latest }, 'dist-tags': { latest } };

describe('dependency freshness', () => {
  test.each(['0.29', '^0.29.0', '=0.29.0'])(
    'rejects a stale declaration %s across semver ranges',
    async (version) => {
      const report = await checkDependencies([dependency(version)], {
        fetchJson: registry('0.31.3'),
      });
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0]).toContain('rust/Cargo.toml:4');
      expect(report.failures[0]).toContain('0.31.3');
    }
  );

  test('accepts current caret and exact versions, including build metadata', async () => {
    for (const version of ['0.31.3', '^0.31.3', '=0.31.3', '0.31.3+metadata']) {
      const report = await checkDependencies([dependency(version)], {
        fetchJson: registry('0.31.3'),
      });
      expect(report.failures).toEqual([]);
    }
  });

  test('uses npm latest, including scoped packages and development dependencies', async () => {
    const urls = [];
    const report = await checkDependencies(
      [dependency('0.8.17', { ecosystem: 'npm', name: '@types/shelljs' })],
      {
        fetchJson: async (url) => {
          urls.push(url);
          return { 'dist-tags': { latest: '0.10.0' } };
        },
      }
    );
    expect(report.failures).toHaveLength(1);
    expect(urls[0]).toContain('%40types%2Fshelljs');
  });

  test('requires the stable npm release rather than a newer prerelease', async () => {
    const report = await checkDependencies(
      [dependency('^1.2.0-beta.15', { ecosystem: 'npm', name: 'node-pty' })],
      { fetchJson: registry('1.1.0') }
    );
    expect(report.failures).toHaveLength(1);
  });

  test('allows a stale dependency only while its documented blocker is open', async () => {
    const dep = dependency('0.29', {
      blocker: 'https://github.com/link-foundation/command-stream/issues/204',
    });
    const open = await checkDependencies([dep], {
      fetchJson: registry('0.31.3'),
    });
    expect(open.failures).toEqual([]);
    expect(open.exemptions).toHaveLength(1);
    const closed = await checkDependencies([dep], {
      fetchJson: registry('0.31.3', 'closed'),
    });
    expect(closed.failures).toHaveLength(1);
  });

  test('fails closed on registry and blocker lookup errors', async () => {
    const report = await checkDependencies([dependency('0.31.3')], {
      fetchJson: async () => {
        throw new Error('HTTP 503');
      },
    });
    expect(report.failures[0]).toContain('HTTP 503');
    const malformed = await checkDependencies([dependency('0.31.3')], {
      fetchJson: async () => ({}),
    });
    expect(malformed.failures).toHaveLength(1);
    const blockerError = await checkDependencies(
      [
        dependency('0.29', {
          blocker:
            'https://github.com/link-foundation/command-stream/issues/204',
        }),
      ],
      {
        fetchJson: async (url) => {
          if (new URL(url).hostname === 'api.github.com') {
            throw new Error('HTTP 403');
          }
          return { crate: { max_stable_version: '0.31.3' } };
        },
      }
    );
    expect(blockerError.failures[0]).toContain('HTTP 403');
  });

  test('checks the npm publishing major against latest, not only npm 11', async () => {
    const dep = dependency('11', {
      ecosystem: 'npm',
      name: 'npm',
      majorOnly: true,
    });
    const report = await checkDependencies([dep], {
      fetchJson: registry('12.2.0'),
    });
    expect(report.failures).toHaveLength(1);
    const current = await checkDependencies([{ ...dep, version: '12' }], {
      fetchJson: registry('12.2.0'),
    });
    expect(current.failures).toEqual([]);
  });

  test('includes pinned CI installations and the npm publishing tool', () => {
    const deps = collectToolDependencies();
    expect(deps.some((dep) => dep.name === 'rust-script')).toBe(true);
    expect(deps.some((dep) => dep.name === 'cargo-audit')).toBe(true);
    expect(deps.some((dep) => dep.name === 'secretlint')).toBe(true);
    expect(deps.some((dep) => dep.name === 'npm' && dep.majorOnly)).toBe(true);
  });

  test('discovers runtime, development, benchmark and embedded script dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'dependency-freshness-'));
    try {
      for (const dir of ['js', 'rust/benchmarks', 'rust/scripts']) {
        mkdirSync(join(root, dir), { recursive: true });
      }
      writeFileSync(
        join(root, 'js/package.json'),
        JSON.stringify({
          dependencies: { execa: '9.6.1' },
          devDependencies: { eslint: '^9.39.5' },
        })
      );
      writeFileSync(
        join(root, 'rust/Cargo.toml'),
        '[dependencies]\nnix = { version = "0.29" } # https://github.com/link-foundation/command-stream/issues/204\n[dev-dependencies]\ntempfile = "3.14"\n'
      );
      writeFileSync(
        join(root, 'rust/benchmarks/Cargo.toml'),
        '[dependencies]\ncommand-stream = { path = ".." }\nchrono = "=0.4.42"\n'
      );
      writeFileSync(
        join(root, 'rust/scripts/release.rs'),
        '//! ```cargo\n//! [dependencies]\n//! ureq = "2"\n//! ```\nfn main() {}\n'
      );
      const deps = collectDependencies(root);
      expect(deps.map((dep) => dep.name).sort()).toEqual([
        'chrono',
        'eslint',
        'execa',
        'nix',
        'tempfile',
        'ureq',
      ]);
      const nix = deps.find((dep) => dep.name === 'nix');
      expect(nix.line).toBe(2);
      expect(nix.blocker).toEndWith('/issues/204');
      expect(deps.find((dep) => dep.name === 'ureq').line).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
