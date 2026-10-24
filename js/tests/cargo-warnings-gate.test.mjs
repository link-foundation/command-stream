// The Rust lint job's clippy step must fail on Cargo's own warnings. RUSTFLAGS
// and `clippy -- -D warnings` deny rustc and clippy warnings only; a manifest
// warning such as an unused key is printed and Cargo still exits 0 (#216).
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = Bun.YAML.parse(
  readFileSync(
    new URL('../../.github/workflows/rust.yml', import.meta.url),
    'utf8'
  )
);
const step = workflow.jobs.lint.steps.find((s) => s.name === 'Run Clippy');

// Output and exit status of the mock `cargo` for each scenario.
const scenarios = [
  ['a clean build passes', '    Checking command-stream v1.5.2\n', 0, 0],
  [
    'a Cargo manifest warning fails',
    'warning: Cargo.toml: unused manifest key: package.typo\n' +
      'warning: `command-stream` (manifest) generated 1 warning\n' +
      '    Checking command-stream v1.5.2\n',
    0,
    1,
  ],
  [
    'a denied clippy lint keeps its own failure status',
    'error: this could be rewritten as `let...else`\n' +
      'error: could not compile `command-stream` due to 1 previous error\n',
    101,
    101,
  ],
];

describe('the clippy step denies Cargo warnings', () => {
  test('clippy runs without colour so warnings are recognisable', () => {
    expect(step.run).toContain(
      'cargo clippy --all-targets --all-features --color never -- -D warnings'
    );
  });

  for (const [name, output, cargoStatus, expected] of scenarios) {
    test.skipIf(process.platform === 'win32')(name, () => {
      const root = mkdtempSync(join(tmpdir(), 'cargo-warnings-'));
      try {
        writeFileSync(join(root, 'output.txt'), output);
        const cargo = join(root, 'cargo');
        writeFileSync(
          cargo,
          `#!/bin/bash\ncat "${root}/output.txt" >&2\nexit ${cargoStatus}\n`
        );
        chmodSync(cargo, 0o755);
        // GitHub runs `run:` blocks on Linux with `bash -eo pipefail`.
        const result = spawnSync(
          '/bin/bash',
          ['-eo', 'pipefail', '-c', step.run],
          {
            cwd: root,
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              RUNNER_TEMP: root,
            },
            encoding: 'utf8',
            timeout: 10_000,
          }
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(expected);
        expect(result.stdout).toContain(output.split('\n')[0]);
        if (expected === 1) {
          expect(result.stdout).toContain('::error::Cargo reported warnings');
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
