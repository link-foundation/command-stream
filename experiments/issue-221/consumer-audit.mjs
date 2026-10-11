// Compare the published dependency contract with an isolated packed install.
// node experiments/issue-221/consumer-audit.mjs command-stream@2.0.0
// node experiments/issue-221/consumer-audit.mjs /absolute/path/to/package.tgz
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'command-stream-consumer-audit-'));
try {
  writeFileSync(join(directory, 'package.json'), '{"private":true}\n');
  const install = spawnSync(
    'npm',
    [
      'install',
      '--omit=dev',
      '--omit=optional',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      process.argv[2],
    ],
    { cwd: directory, encoding: 'utf8' }
  );
  if (install.status !== 0) {
    throw new Error(install.stderr || install.stdout);
  }
  const lock = JSON.parse(
    readFileSync(join(directory, 'package-lock.json'), 'utf8')
  );
  const chain = Object.keys(lock.packages).filter((name) =>
    /node_modules\/(?:shelljs|@types\/shelljs|fast-glob|micromatch|braces)$/.test(
      name
    )
  );
  const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: directory,
    encoding: 'utf8',
  });
  const report = JSON.parse(audit.stdout);
  if (report.error) {
    throw new Error(JSON.stringify(report.error));
  }
  console.log(
    JSON.stringify(
      {
        package: process.argv[2],
        chain,
        vulnerabilities: report.metadata.vulnerabilities,
        braces: report.vulnerabilities?.braces,
      },
      null,
      2
    )
  );
  process.exitCode = audit.status;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
