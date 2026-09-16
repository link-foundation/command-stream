#!/usr/bin/env node
// Runs every feature example under every installed runtime and fails if any two
// runtimes disagree.
//
// Each example prints a JSON block under COMMAND_STREAM_PARITY=1 listing what it
// observed. Comparing those blocks is what "the feature behaves the same
// everywhere" means in this repository, and it is checked in CI.
//
//   node scripts/check-parity.mjs            compare every installed runtime
//   node scripts/check-parity.mjs --json     print the report as JSON
import { runExamples } from './run-examples.mjs';

const asJson = process.argv.includes('--json');
const report = await runExamples();

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Runtimes: ${report.runtimes.map(r => `${r.label} ${r.version}`).join(', ')}`);
  console.log('');
  for (const feature of report.features) {
    const mark = feature.parity ? '✓' : '✗';
    console.log(`${mark} ${feature.id}`);
    if (!feature.parity) {
      for (const difference of feature.differences) {
        console.log(`    ${difference}`);
      }
    }
  }
  console.log('');
}

const broken = report.features.filter(feature => !feature.parity);
if (broken.length > 0) {
  console.error(`${broken.length} feature(s) behave differently between runtimes: ${broken.map(f => f.id).join(', ')}`);
  process.exit(1);
}

console.log(`All ${report.features.length} features behave identically in ${report.runtimes.length} runtime(s).`);
