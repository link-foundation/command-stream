// Exercise the current checkout over HTTP with esm.sh's dependency and
// CommonJS resolution semantics, without publishing a candidate to npm.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CdnProbeError, retryCdnProbe } from './deno-cdn-retry.mjs';

const packageDirectory = new URL('../', import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL('package.json', packageDirectory), 'utf8')
);
const commonJsImports = new Map();
const cdnDependencies = new Set();
const builtins = new Set(
  builtinModules.map((name) => name.replace(/^node:/, ''))
);
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/$.mjs', packageDirectory))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'cdn-dependencies',
      setup(builder) {
        builder.onResolve({ filter: /^[\w@]/ }, (args) => {
          const name = args.path.replace(/^node:/, '');
          let path;
          if (args.path.startsWith('node:') || builtins.has(name)) {
            path = `node:${name}`;
          } else {
            const version = manifest.dependencies[args.path];
            if (!version) {
              throw new Error(`Undeclared CDN dependency: ${args.path}`);
            }
            cdnDependencies.add(args.path);
            // Process runners need Node conditional exports, including
            // unicorn-magic's filesystem helpers used by current Execa.
            path = `https://esm.sh/${args.path}@${version}?target=denonext&conditions=node`;
          }
          if (args.kind === 'require-call' && !commonJsImports.has(path)) {
            commonJsImports.set(path, `cdn${commonJsImports.size}`);
          }
          return { path, external: true };
        });
      },
    },
  ],
});

// esm.sh replaces require.resolve with an identity function, and rewrites
// literal require calls to static imports. Dynamic createRequire calls still
// use Deno's real node:module implementation.
function stringLiteral(value) {
  // Escape HTML delimiters as well as quotes in generated JavaScript.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
const imports = [...commonJsImports].map(
  ([path, name]) => `import * as ${name} from ${stringLiteral(path)};`
);
const cases = [...commonJsImports].map(
  ([path, name]) =>
    `case ${stringLiteral(path)}: return ${name}.default ?? ${name};`
);
const bundle = [
  'import process from "node:process";',
  'import { Buffer } from "node:buffer";',
  ...imports,
  `const require = (name) => { switch(name) { ${cases.join('\n')} } throw new Error('Unknown CDN require: ' + name); };`,
  'require.resolve = (name) => name;',
  result.outputFiles[0].text,
].join('\n');

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/javascript' });
  response.end(bundle);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const url = `http://127.0.0.1:${server.address().port}/command-stream.mjs`;
  await runProbe(url);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

// CI also asks the real CDN to compile the immutable PR head. The local HTTP
// probe above covers the fresh merge result, including unpublished base changes.
if (process.env.COMMAND_STREAM_CDN_REVISION) {
  const repository = process.env.COMMAND_STREAM_CDN_REPOSITORY;
  const revision = process.env.COMMAND_STREAM_CDN_REVISION;
  const url = new URL(
    `https://esm.sh/gh/${repository}@${revision}/js/src/$.mjs`
  );
  url.searchParams.set('target', 'denonext');
  url.searchParams.set('conditions', 'node');
  url.searchParams.set(
    'deps',
    // Pin only this entry point's imports, preserving transitive version ranges.
    [...cdnDependencies]
      .map((name) => `${name}@${manifest.dependencies[name]}`)
      .join(',')
  );
  await runProbe(url.href);
}

async function runProbe(url) {
  await retryCdnProbe(() => runProbeOnce(url));
}

async function runProbeOnce(url) {
  const probe = fileURLToPath(
    new URL('../../experiments/issue-219/cdn-import.mjs', import.meta.url)
  );
  const child = spawn('deno', ['run', '-A', '--no-lock', probe, url], {
    stdio: ['inherit', 'inherit', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    // Keep a bounded diagnostic tail while preserving the full CI log.
    stderr = (stderr + chunk.toString()).slice(-65536);
  });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) {
    throw new CdnProbeError(code, stderr);
  }
}
