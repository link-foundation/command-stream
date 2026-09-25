#!/usr/bin/env node
// Generates the feature documentation from the catalog and from what the
// examples actually printed.
//
// Nothing here is written by hand: the code shown is the example file, and the
// output shown is the output that example produced in each installed runtime.
// Documentation therefore cannot drift from the library - if it did, the parity
// check would have failed first.
//
//   node scripts/generate-docs.mjs          write docs/
//   node scripts/generate-docs.mjs --check  fail if docs/ is out of date
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prettier from '../js/node_modules/prettier/index.mjs';
import { runExamples } from './run-examples.mjs';
import {
  features,
  libraries,
  categories,
  languages,
  rustApiByFeature,
} from '../js/examples/features/catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(root, 'docs');
const featuresDir = path.join(docsDir, 'features');
const siteDir = path.join(docsDir, 'site');

const checkOnly = process.argv.includes('--check');

const REPO = 'https://github.com/link-foundation/command-stream';

const generated = new Map();
function emit(relativePath, contents) {
  generated.set(relativePath, contents);
}

function alternativeText(alternative) {
  if (!alternative) {
    return null;
  }
  if (typeof alternative === 'string') {
    return { supported: true, code: alternative };
  }
  return { supported: false, reason: alternative.unsupported };
}

// ---------------------------------------------------------------- feature page

// The sequential pushes mirror the document's section order and keep the
// generated Markdown easy to compare with the rendered page.
// eslint-disable-next-line max-statements
function featurePage(feature, run, runtimes) {
  const lines = [];
  lines.push(`# ${feature.title}`);
  lines.push('');
  lines.push(feature.summary);
  lines.push('');
  lines.push(`**Category:** ${feature.category}`);
  lines.push('');
  lines.push(
    `**Languages:** ${languages.map((language) => language.name).join(', ')}`
  );
  lines.push('');
  lines.push('## JavaScript');
  lines.push('');
  lines.push(`**API:** ${feature.api.map((name) => `\`${name}\``).join(', ')}`);
  lines.push('');
  lines.push(
    `**Verified in:** ${runtimes.map((runtime) => runtime.label).join(', ')}`
  );
  lines.push('');
  lines.push('### Example');
  lines.push('');
  lines.push(`[\`${feature.file}\`](${REPO}/blob/main/${feature.file})`);
  lines.push('');
  lines.push('```js');
  lines.push(run.source.trimEnd());
  lines.push('```');
  lines.push('');
  lines.push('### Output');
  lines.push('');

  const reports = runtimes.map((runtime) => run.runs[runtime.id]?.report ?? '');
  const identical = reports.every((report) => report === reports[0]);

  if (identical) {
    lines.push(
      `Identical in ${runtimes.map((runtime) => runtime.label).join(' and ')}:`
    );
    lines.push('');
    lines.push('```');
    lines.push(reports[0].trimEnd());
    lines.push('```');
  } else {
    for (const [index, runtime] of runtimes.entries()) {
      lines.push(`### ${runtime.label}`);
      lines.push('');
      lines.push('```');
      lines.push(reports[index].trimEnd());
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('');
  lines.push('## Rust');
  lines.push('');
  lines.push(
    `**API:** ${rustApiByFeature
      .get(feature.id)
      .map((name) => `\`${name}\``)
      .join(', ')}`
  );
  lines.push('');
  lines.push('### Example');
  lines.push('');
  lines.push(
    `[\`rust/examples/language_features.rs\`](${REPO}/blob/main/rust/examples/language_features.rs)`
  );
  lines.push('');
  lines.push('```rust');
  lines.push(run.rust.source.trimEnd());
  lines.push('```');
  lines.push('');
  lines.push('### Output');
  lines.push('');
  lines.push('```');
  lines.push(run.rust.report.trimEnd());
  lines.push('```');
  lines.push('');
  lines.push('## The same thing in other libraries');
  lines.push('');

  for (const library of libraries.filter(
    (library) => library.id !== 'command-stream'
  )) {
    const alternative = alternativeText(feature.alternatives[library.id]);
    lines.push(`### [${library.name}](${library.url})`);
    lines.push('');
    if (!alternative) {
      lines.push('_Not compared._');
    } else if (alternative.supported) {
      lines.push('```js');
      lines.push(alternative.code);
      lines.push('```');
    } else {
      lines.push(`Not supported — ${alternative.reason}.`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('[← All features](../README.md)');
  lines.push('');
  return lines.join('\n');
}

// ----------------------------------------------------------------- index page

function indexPage(report) {
  const { runtimes } = report;
  const lines = [];
  lines.push('# Feature documentation');
  lines.push('');
  lines.push(
    'Every feature of command-stream, with executable JavaScript and Rust examples,'
  );
  lines.push(
    'captured output, and the same thing written with other shell libraries.'
  );
  lines.push('');
  lines.push(
    'This file is generated by `node scripts/generate-docs.mjs`. Edit the examples in'
  );
  lines.push(
    '`js/examples/features/` or the catalog in `js/examples/features/catalog.mjs` instead.'
  );
  lines.push('');
  lines.push('## Language and runtime parity');
  lines.push('');
  lines.push(
    `All ${report.features.length} examples were executed in JavaScript and Rust. JavaScript was checked in ${runtimes.map((runtime) => runtime.label).join(' and ')}.`
  );
  lines.push('');
  lines.push(
    `| Feature | ${runtimes.map((runtime) => `JavaScript (${runtime.label})`).join(' | ')} | Rust |`
  );
  lines.push(`| --- | ${runtimes.map(() => '---').join(' | ')} | --- |`);
  for (const run of report.features) {
    const feature = features.find((entry) => entry.id === run.id);
    const cells = runtimes.map((runtime) =>
      run.runs[runtime.id]?.failed ? '✗' : '✓'
    );
    lines.push(
      `| [${feature.title}](features/${feature.id}.md) | ${cells.join(' | ')} | ${run.rust.failed ? '✗' : '✓'} |`
    );
  }
  lines.push('');
  lines.push('## Library comparison');
  lines.push('');
  lines.push(
    '✓ supported, — not supported. Follow a feature for the code in each library.'
  );
  lines.push('');
  const others = libraries.filter((library) => library.id !== 'command-stream');
  lines.push(
    `| Feature | command-stream | ${others.map((library) => library.name).join(' | ')} |`
  );
  lines.push(`| --- | --- | ${others.map(() => '---').join(' | ')} |`);
  for (const feature of features) {
    const cells = others.map((library) => {
      const alternative = alternativeText(feature.alternatives[library.id]);
      return alternative?.supported ? '✓' : '—';
    });
    lines.push(
      `| [${feature.title}](features/${feature.id}.md) | ✓ | ${cells.join(' | ')} |`
    );
  }
  lines.push('');
  lines.push('## Features by category');
  lines.push('');
  for (const category of categories) {
    const inCategory = features.filter(
      (feature) => feature.category === category
    );
    if (inCategory.length === 0) {
      continue;
    }
    lines.push(`### ${category}`);
    lines.push('');
    for (const feature of inCategory) {
      lines.push(
        `- [${feature.title}](features/${feature.id}.md) — ${feature.summary}`
      );
    }
    lines.push('');
  }
  lines.push('## Libraries compared');
  lines.push('');
  lines.push('| Library | Version | Runs in |');
  lines.push('| --- | --- | --- |');
  for (const library of libraries) {
    lines.push(
      `| [${library.name}](${library.url}) | ${library.version ?? 'this repository'} | ${library.runtimes.join(', ')} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

// -------------------------------------------------------------------- website

// Keeping the site in one template makes the single-file Pages artifact
// portable and avoids a second asset-generation pipeline.
// eslint-disable-next-line max-lines-per-function
function website(report) {
  const data = {
    runtimes: report.runtimes.map((runtime) => ({
      id: runtime.id,
      label: runtime.label,
    })),
    languages,
    libraries,
    categories,
    features: features.map((feature) => {
      const run = report.features.find((entry) => entry.id === feature.id);
      const reports = report.runtimes.map(
        (runtime) => run.runs[runtime.id]?.report ?? ''
      );
      return {
        ...feature,
        source: run.source.trimEnd(),
        rustApi: rustApiByFeature.get(feature.id),
        rustSource: run.rust.source.trimEnd(),
        rustOutput: run.rust.report.trimEnd(),
        identicalOutput: reports.every((text) => text === reports[0]),
        output: Object.fromEntries(
          report.runtimes.map((runtime, index) => [
            runtime.id,
            reports[index].trimEnd(),
          ])
        ),
      };
    }),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>command-stream — feature comparison</title>
<style>
:root { color-scheme: light dark; --line: #8883; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.55 system-ui, sans-serif; }
header { padding: 2rem 1.5rem 1rem; border-bottom: 1px solid var(--line); }
h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
p.lede { margin: 0; opacity: .75; }
main { display: grid; grid-template-columns: 17rem 1fr; min-height: 60vh; }
nav { border-right: 1px solid var(--line); padding: 1rem; }
nav input { width: 100%; padding: .45rem .6rem; margin-bottom: .75rem; border: 1px solid var(--line); border-radius: .35rem; background: transparent; color: inherit; font: inherit; }
nav h2 { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin: 1rem 0 .35rem; }
nav a { display: block; padding: .2rem .35rem; border-radius: .25rem; text-decoration: none; color: inherit; }
nav a:hover, nav a.active { background: #8882; }
section { padding: 1.5rem; max-width: 60rem; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0 1.5rem; }
th, td { border: 1px solid var(--line); padding: .35rem .5rem; text-align: left; }
pre { background: #8881; padding: .75rem; border-radius: .4rem; overflow-x: auto; }
code { font-family: ui-monospace, monospace; font-size: .86em; }
.badge { display: inline-block; padding: .1rem .45rem; border: 1px solid var(--line); border-radius: 999px; font-size: .75rem; }
.unsupported { opacity: .7; font-style: italic; }
footer { padding: 1rem 1.5rem 3rem; opacity: .7; font-size: .85rem; }
@media (max-width: 720px) { main { grid-template-columns: 1fr; } nav { border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
</head>
<body>
<header>
  <h1>command-stream — feature comparison</h1>
  <p class="lede">Every feature in JavaScript and Rust, plus equivalent code in other shell libraries.</p>
</header>
<main>
  <nav>
    <input id="filter" type="search" placeholder="Filter features" aria-label="Filter features">
    <a href="#overview">Overview</a>
    <div id="nav-links"></div>
  </nav>
  <section id="content"></section>
</main>
<footer>Generated from executable examples in <code>js/examples/features/</code> and <code>rust/examples/language_features.rs</code>.</footer>
<script id="data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
const data = JSON.parse(document.getElementById('data').textContent);
const others = data.libraries.filter(library => library.id !== 'command-stream');
const byId = new Map(data.features.map(feature => [feature.id, feature]));

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = String(text);
  if (className) result.className = className;
  return result;
}

function featureLink(feature) {
  const link = element('a', feature.title);
  link.href = '#' + encodeURIComponent(feature.id);
  return link;
}

function externalLink(library) {
  const link = element('a', library.name);
  const url = new URL(library.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Unsupported documentation URL protocol');
  }
  link.href = url.href;
  return link;
}

function codeBlock(text) {
  const pre = element('pre');
  pre.append(element('code', text));
  return pre;
}

function badges(names) {
  const paragraph = element('p');
  for (const name of names) {
    const badge = element('span', undefined, 'badge');
    badge.append(element('code', name));
    paragraph.append(badge, ' ');
  }
  return paragraph;
}

function comparisonTable(headers, rows) {
  const table = element('table');
  const head = element('thead');
  const headRow = element('tr');
  for (const header of headers) headRow.append(element('th', header));
  head.append(headRow);

  const body = element('tbody');
  for (const values of rows) {
    const row = element('tr');
    for (const value of values) {
      const cell = element('td');
      if (typeof value === 'string') cell.textContent = value;
      else cell.append(value);
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function renderNav(query) {
  const needle = query.trim().toLowerCase();
  const fragment = document.createDocumentFragment();
  for (const category of data.categories) {
    const matches = data.features.filter(feature =>
      feature.category === category &&
      (needle === '' || (feature.title + ' ' + feature.summary + ' ' + feature.api.join(' ')).toLowerCase().includes(needle)));
    if (matches.length === 0) continue;
    fragment.append(element('h2', category));
    for (const feature of matches) fragment.append(featureLink(feature));
  }
  document.getElementById('nav-links').replaceChildren(fragment);
  markActive();
}

function markActive() {
  const current = location.hash.slice(1);
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle('active', link.getAttribute('href') === '#' + current);
  }
}

function overview() {
  const fragment = document.createDocumentFragment();
  fragment.append(
    element('h2', 'Language and runtime parity'),
    element('p', 'Every feature below has an executable JavaScript and Rust example. JavaScript output is also compared across Node and Bun.'),
    comparisonTable(
      ['Feature', ...data.runtimes.map(runtime => 'JavaScript (' + runtime.label + ')'), 'Rust'],
      data.features.map(feature => [featureLink(feature), ...data.runtimes.map(() => '✓'), '✓'])
    ),
    element('h2', 'Library comparison'),
    comparisonTable(
      ['Feature', 'command-stream', ...others.map(library => library.name)],
      data.features.map(feature => [
        featureLink(feature),
        '✓',
        ...others.map(library => {
          const alternative = feature.alternatives[library.id];
          return typeof alternative === 'string' ? '✓' : '—';
        })
      ])
    )
  );
  return fragment;
}

function featureView(feature) {
  const fragment = document.createDocumentFragment();
  fragment.append(element('h2', feature.title), element('p', feature.summary));
  const category = element('p');
  category.append(element('span', feature.category, 'badge'));
  fragment.append(
    category,
    element('h3', 'JavaScript'),
    badges(feature.api),
    element('h4', 'Example'),
    codeBlock(feature.source),
    element('h4', 'Output')
  );

  if (feature.identicalOutput) {
    fragment.append(
      element('p', 'Identical in ' + data.runtimes.map(runtime => runtime.label).join(' and ') + ':'),
      codeBlock(feature.output[data.runtimes[0].id])
    );
  } else {
    for (const runtime of data.runtimes) {
      fragment.append(element('h4', runtime.label), codeBlock(feature.output[runtime.id]));
    }
  }

  fragment.append(
    element('h3', 'Rust'),
    badges(feature.rustApi),
    element('h4', 'Example'),
    codeBlock(feature.rustSource),
    element('h4', 'Output'),
    codeBlock(feature.rustOutput),
    element('h3', 'The same thing in other libraries')
  );

  for (const library of others) {
    const heading = element('h4');
    heading.append(externalLink(library));
    fragment.append(heading);
    const alternative = feature.alternatives[library.id];
    fragment.append(
      typeof alternative === 'string'
        ? codeBlock(alternative)
        : element('p', 'Not supported — ' + alternative.unsupported + '.', 'unsupported')
    );
  }
  return fragment;
}

function render() {
  let id = '';
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* Invalid hash: show overview. */ }
  const feature = byId.get(id);
  document.getElementById('content').replaceChildren(feature ? featureView(feature) : overview());
  markActive();
  window.scrollTo(0, 0);
}

document.getElementById('filter').addEventListener('input', event => renderNav(event.target.value));
window.addEventListener('hashchange', render);
renderNav('');
render();
</script>
</body>
</html>
`;
}

// ------------------------------------------------------------------ generate

const report = await runExamples();

const broken = report.features.filter((feature) => !feature.parity);
if (broken.length > 0) {
  console.error(
    `Refusing to document behaviour that differs between runtimes: ${broken.map((feature) => feature.id).join(', ')}`
  );
  console.error('Run `node scripts/check-parity.mjs` to see the differences.');
  process.exit(1);
}

for (const feature of features) {
  const run = report.features.find((entry) => entry.id === feature.id);
  emit(
    path.join('docs', 'features', `${feature.id}.md`),
    featurePage(feature, run, report.runtimes)
  );
}
emit(path.join('docs', 'README.md'), indexPage(report));
emit(path.join('docs', 'site', 'index.html'), website(report));

const prettierConfig =
  (await prettier.resolveConfig(path.join(root, 'README.md'))) ?? {};
for (const [relativePath, contents] of generated) {
  generated.set(
    relativePath,
    await prettier.format(contents, {
      ...prettierConfig,
      filepath: path.join(root, relativePath),
    })
  );
}

if (checkOnly) {
  const stale = [];
  for (const [relativePath, contents] of generated) {
    const absolute = path.join(root, relativePath);
    if (
      !fs.existsSync(absolute) ||
      fs.readFileSync(absolute, 'utf8') !== contents
    ) {
      stale.push(relativePath);
    }
  }
  if (stale.length > 0) {
    console.error('Generated documentation is out of date:');
    for (const file of stale) {
      console.error(`  ${file}`);
    }
    console.error(
      '\nRun `node scripts/generate-docs.mjs` and commit the result.'
    );
    process.exit(1);
  }
  console.log(`Documentation is up to date (${generated.size} files).`);
} else {
  fs.mkdirSync(featuresDir, { recursive: true });
  fs.mkdirSync(siteDir, { recursive: true });
  for (const [relativePath, contents] of generated) {
    fs.writeFileSync(path.join(root, relativePath), contents);
  }
  console.log(`Wrote ${generated.size} files to docs/.`);
}
