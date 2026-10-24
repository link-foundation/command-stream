// Fresh-process import measurements: node experiments/issue-235/import-probe.mjs
// [command-stream | command-stream/core] [import | require]
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const entry = process.argv[2] ?? 'command-stream';
const mode = process.argv[3] ?? 'import';
const packageFile = require.resolve('command-stream/package.json');
const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
const subpath =
  entry === 'command-stream' ? '.' : `.${entry.slice('command-stream'.length)}`;
const importTarget = manifest.exports[subpath]?.import?.default;
const modules = new Set();
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('node:')) {
      modules.add(url);
    }
    return nextLoad(url, context);
  },
});
const start = performance.now();
const api =
  mode === 'require'
    ? require(entry)
    : await import(
        new URL(
          importTarget ?? './missing-core-entry.mjs',
          pathToFileURL(packageFile)
        ).href
      );
const ms = performance.now() - start;
hook.deregister();
if (typeof api.$ !== 'function' || typeof api.ProcessRunner !== 'function') {
  throw new Error('Entry must export $ and ProcessRunner');
}
console.log(
  JSON.stringify({
    entry,
    mode,
    ms,
    count: modules.size,
    modules: [...modules],
  })
);
