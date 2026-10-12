// Finite offline probe: a named npm install honors an existing file dependency
// and skips lifecycle scripts, as required by Rust's manifest installation API.
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { strict as assert } from 'node:assert';

const directory = await mkdtemp(join(tmpdir(), 'issue30-npm-manifest-'));
try {
  await mkdir(join(directory, 'source'));
  await writeFile(
    join(directory, 'source/package.json'),
    JSON.stringify({
      name: '@example/tools',
      version: '1.0.0',
      scripts: { install: 'node -e "process.exit(99)"' },
    })
  );
  await writeFile(
    join(directory, 'source/command-stream.json'),
    JSON.stringify({
      name: 'offline-manifest',
      version: '1',
      commands: { hello: { file: 'echo' } },
    })
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'offline-consumer',
      version: '1.0.0',
      dependencies: { '@example/tools': 'file:./source' },
    })
  );
  await writeFile(
    join(directory, '.npmrc'),
    'offline=true\nregistry=http://127.0.0.1:9\n'
  );
  await promisify(execFile)(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--',
      '@example/tools',
    ],
    { cwd: directory }
  );
  const manifest = JSON.parse(
    await readFile(
      join(directory, 'node_modules/@example/tools/command-stream.json'),
      'utf8'
    )
  );
  assert.equal(manifest.name, 'offline-manifest');
  console.log(
    'Offline named npm installation skipped lifecycle scripts and resolved its manifest'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
