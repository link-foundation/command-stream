// Reproduction harness for issue #189.
//
// Before the fix, package.json exported only './src/$.mjs', so from a CommonJS
// host `require('command-stream')` failed with ERR_REQUIRE_ESM on runtimes
// without require(esm), and returned a namespace object (not a callable `$`)
// on the runtimes that do support it.
//
// This script installs the package into a throwaway sandbox and reports what a
// CommonJS host actually observes on the current runtime.
//
// Run with: node js/experiments/repro-189-commonjs-require.mjs

import {
  createCommonJsSandbox,
  removeCommonJsSandbox,
  runSandboxScript,
  supportsRequireEsm,
} from '../tests/commonjs-sandbox.mjs';

const sandbox = createCommonJsSandbox();

try {
  console.log(`node ${process.versions.node}`);
  console.log(
    `require(esm) supported: ${supportsRequireEsm(process.versions.node)}`
  );

  const result = runSandboxScript(sandbox, 'repro.cjs', [
    "const loaded = require('command-stream');",
    "console.log('typeof require result:', typeof loaded);",
    "console.log('callable as a tagged template:', typeof loaded === 'function');",
    'const probe = loaded({ mirror: false })`echo sync-probe`.sync();',
    "console.log('sync probe:', JSON.stringify(probe.stdout), 'code:', probe.code);",
  ]);

  console.log(`exit status: ${result.status}`);
  if (result.stdout) {
    console.log(result.stdout.trimEnd());
  }
  if (result.stderr) {
    console.log('stderr:');
    console.log(result.stderr.trimEnd());
  }
} finally {
  removeCommonJsSandbox(sandbox);
}
