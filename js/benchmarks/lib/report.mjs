import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const number = (value, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : 'n/a';

function performanceSection(suite) {
  return suite.scenarios
    .map((scenario) => {
      const fastest = scenario.ranking[0]?.medianMs ?? 0;
      const rows = scenario.ranking
        .map(({ name, medianMs, relativeToFastest }) => {
          const width = Math.max(2, (fastest / medianMs) * 100);
          return `<tr><td>${escapeHtml(name)}</td><td>${number(medianMs)} ms</td><td>${number(relativeToFastest)}x</td><td><span class="bar" style="width:${number(width)}%"></span></td></tr>`;
        })
        .join('');
      return `<details open><summary>${escapeHtml(scenario.name)}</summary><table><thead><tr><th>API</th><th>Median</th><th>vs fastest</th><th>Relative speed</th></tr></thead><tbody>${rows}</tbody></table></details>`;
    })
    .join('');
}

function featureSection(suite) {
  const rows = suite.competitors
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.name)}</td><td>${entry.supported}</td><td>${entry.gaps}</td><td>${number(entry.coveragePercent, 1)}%</td></tr>`
    )
    .join('');
  return `<table><thead><tr><th>Upstream corpus</th><th>Ported behaviors</th><th>Known gaps</th><th>Coverage</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sizeSection(suite) {
  const rows = suite.packages
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(entry.version)}</td><td>${entry.packedBytes.toLocaleString()}</td><td>${entry.installedBytes.toLocaleString()}</td><td>${entry.minimalBundleBytes.toLocaleString()}</td><td>${number(entry.treeShakingPercent, 1)}%</td><td>${entry.importMemory ? entry.importMemory.heapUsedBytes.toLocaleString() : 'built in'}</td></tr>`
    )
    .join('');
  return `<table><thead><tr><th>Package</th><th>Version</th><th>npm pack (bytes)</th><th>Installed closure</th><th>Minimal bundle</th><th>Tree-shaken</th><th>Import heap delta</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSuite(suite) {
  if (suite.kind === 'performance' || suite.kind === 'real-world') {
    return performanceSection(suite);
  }
  if (suite.kind === 'features') {
    return featureSection(suite);
  }
  if (suite.kind === 'bundle-size') {
    return sizeSection(suite);
  }
  return `<pre>${escapeHtml(JSON.stringify(suite, null, 2))}</pre>`;
}

function htmlReport(report) {
  const sections = report.suites
    .map(
      (suite) =>
        `<section><h2>${escapeHtml(suite.name)}</h2>${renderSuite(suite)}</section>`
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>command-stream benchmark report</title>
<style>body{font:15px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#172033}h1,h2{color:#0d4a6b}section{margin:2rem 0}details{margin:1rem 0}summary{font-weight:700;cursor:pointer}table{border-collapse:collapse;width:100%;margin:.8rem 0}th,td{text-align:left;padding:.55rem;border-bottom:1px solid #d8dee8}.bar{display:block;background:#28a3d7;height:.8rem;max-width:100%}.meta{color:#52606d}code{background:#eef2f6;padding:.1rem .25rem}</style></head>
<body><h1>command-stream benchmark report</h1><p class="meta">Generated ${escapeHtml(report.generatedAt)} with ${escapeHtml(report.environment.runtime)} on ${escapeHtml(report.environment.platform)} ${escapeHtml(report.environment.arch)}. Lower latency is better.</p>${sections}</body></html>`;
}

export async function writeReports(report, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, 'benchmark-results.json');
  const htmlPath = join(outputDirectory, 'benchmark-report.html');
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(htmlPath, htmlReport(report)),
  ]);
  return { json: jsonPath, html: htmlPath };
}
