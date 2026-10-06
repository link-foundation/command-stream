// Port of zx test/it/build-npm.test.js (issue #26). Test vectors come from
// google/zx (Apache-2.0) at the pinned corpus commit.
//
// Upstream packs its `build/` output and checks the tarball's file list, then
// installs it into sample js/ts/esbuild projects. command-stream ships the
// zx-compatible layer as plain ESM under src/zx, so the port packs js/ with
// `npm pack`, installs the unpacked tree into throwaway projects by copying
// (the zx layer has no third-party dependencies) and runs the same scenarios.
// Instead of a hard-coded file list, `zx full` asserts that every zx module
// and every `exports`/`bin` target made it into the tarball.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe } from 'node:test';
import {
  IT_TIMEOUT,
  LITE_FILES,
  ROOT,
  devBin,
  linkDevModule,
  listFiles,
  makeProject,
  packArtifact,
  run,
  runOk,
  writeFiles,
} from './fixtures/it/artifact.mjs';

const VERBOSE_ECHO_ESM = `import { $ } from 'command-stream/zx/core';
$.verbose = true;
await $\`echo hello\`;
`;

const VERBOSE_ECHO_CJS = `const { $ } = require('command-stream/zx/core');
$.verbose = true;
$\`echo hello\`.then(() => {});
`;

// Every string reachable from package.json#exports.
const exportTargets = (node) =>
  typeof node === 'string'
    ? [node]
    : Object.values(node ?? {}).flatMap(exportTargets);

const rel = (file) => file.replace(/^\.\//, '');

describe('npm artifact', () => {
  describe('contents', () => {
    test(
      '[zx:test/it/build-npm.test.js:36:5:registration] zx full',
      { timeout: IT_TIMEOUT },
      async () => {
        const project = await makeProject();
        writeFiles(project, { 'run.mjs': VERBOSE_ECHO_ESM });
        const { stderr } = await runOk(process.execPath, ['run.mjs'], {
          cwd: project,
        });
        assert.match(stderr, /hello/);

        const pkgDir = await packArtifact();
        const pkgJson = JSON.parse(
          fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')
        );
        const files = listFiles(pkgDir);

        assert.equal(pkgJson.name, 'command-stream');
        assert.equal(pkgJson.bin['command-stream'], './src/zx/cli.mjs');
        for (const file of listFiles(path.join(ROOT, 'src/zx'))) {
          assert.ok(files.includes(`src/zx/${file}`), `missing src/zx/${file}`);
        }
        const targets = [
          ...exportTargets(pkgJson.exports),
          ...Object.values(pkgJson.bin),
        ].map(rel);
        for (const target of targets) {
          assert.ok(files.includes(target), `missing ${target}`);
        }
        assert.ok(
          !files.some((file) => /^(tests|experiments)\//.test(file)),
          'tests and experiments must not be published'
        );
      }
    );

    test(
      '[zx:test/it/build-npm.test.js:125:5:registration] zx@lite',
      { timeout: IT_TIMEOUT },
      async () => {
        // The lite package keeps only what `command-stream/zx/core` reaches.
        const project = await makeProject({ files: LITE_FILES });
        writeFiles(project, {
          'run.mjs': VERBOSE_ECHO_ESM,
          'run.cjs': VERBOSE_ECHO_CJS,
          'full.mjs': "import 'command-stream/zx';\n",
        });

        const esm = await runOk(process.execPath, ['run.mjs'], {
          cwd: project,
        });
        assert.match(esm.stderr, /hello/);
        const cjs = await runOk(process.execPath, ['run.cjs'], {
          cwd: project,
        });
        assert.match(cjs.stderr, /hello/);

        const installed = path.join(project, 'node_modules/command-stream');
        assert.deepEqual(
          listFiles(installed),
          ['package.json', ...LITE_FILES].sort()
        );
        // The full entry needs the extras the lite tree leaves out.
        const full = await run(process.execPath, ['full.mjs'], {
          cwd: project,
        });
        assert.notEqual(full.code, 0);
      }
    );
  });

  describe('compatibility', () => {
    test(
      '[zx:test/it/build-npm.test.js:192:5:registration] js',
      { timeout: IT_TIMEOUT },
      async () => {
        const project = await makeProject({ pkgJson: { type: 'module' } });
        writeFiles(project, { 'script.js': '$`echo js-script`\n' });
        const out = await runOk(
          process.execPath,
          [
            'node_modules/command-stream/src/zx/cli.mjs',
            '--verbose',
            'script.js',
          ],
          { cwd: project }
        );
        assert.match(out.stderr, /js-script/);
      }
    );

    test(
      '[zx:test/it/build-npm.test.js:201:5:registration] tsc',
      { timeout: IT_TIMEOUT },
      async () => {
        const project = await makeProject({ pkgJson: { type: 'module' } });
        linkDevModule(project, '@types');
        writeFiles(project, {
          'script.ts': `import { $, ProcessPromise } from 'command-stream/zx'

const p: ProcessPromise = $({ verbose: true })\`echo ts-script\`
await p
`,
          'tsconfig.json': JSON.stringify({
            compilerOptions: {
              outDir: './build',
              target: 'es2021',
              module: 'nodenext',
              moduleResolution: 'nodenext',
              allowSyntheticDefaultImports: true,
              strict: true,
            },
            include: ['*.ts'],
          }),
        });
        await runOk(devBin('tsc'), ['-p', '.'], { cwd: project });
        const out = await runOk(process.execPath, ['build/script.js'], {
          cwd: project,
        });
        assert.match(out.stderr, /ts-script/);
      }
    );

    test(
      '[zx:test/it/build-npm.test.js:215:5:registration] tsc (isolated)',
      { timeout: IT_TIMEOUT },
      async () => {
        const project = await makeProject({ pkgJson: { name: 'zx-test' } });
        linkDevModule(project, '@types');
        writeFiles(project, {
          'tsconfig.json': JSON.stringify({
            compilerOptions: {
              module: 'commonjs',
              target: 'esnext',
              outDir: 'bundle',
              rootDir: 'src',
              declaration: true,
              declarationMap: false,
              esModuleInterop: true,
            },
            include: ['src'],
          }),
          'src/index.ts': `import {$} from 'command-stream/zx'
(async () => {
  await $({verbose: true})\`echo hello\`
})()
`,
        });
        await runOk(devBin('tsc'), ['-p', '.'], { cwd: project });
        const out = await runOk(process.execPath, ['bundle/index.js'], {
          cwd: project,
        });
        assert.strictEqual(out.all, '$ echo hello\nhello\n');
      }
    );

    test(
      '[zx:test/it/build-npm.test.js:257:5:registration] esbuild (iife)',
      { timeout: IT_TIMEOUT },
      async () => {
        const project = await makeProject({ pkgJson: { name: 'zx-test' } });
        writeFiles(project, {
          'src/ver.js': `import {version, $} from 'command-stream/zx'
(async () => {
  await $({verbose: true})\`echo \${version}\`
})()
`,
        });
        await runOk(
          devBin('esbuild'),
          [
            'src/ver.js',
            '--bundle',
            '--format=iife',
            '--platform=node',
            '--outfile=bundle/ver.js',
          ],
          { cwd: project }
        );
        const { version } = await import('../../src/zx/index.mjs');
        const out = await runOk(process.execPath, ['bundle/ver.js'], {
          cwd: project,
        });
        assert.strictEqual(out.all, `$ echo ${version}\n${version}\n`);
      }
    );
  });
});
