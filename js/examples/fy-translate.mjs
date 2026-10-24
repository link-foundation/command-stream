#!/usr/bin/env bun

/**
 * Demonstrates the `$fy` shell-to-JavaScript translator.
 *
 * The translation is rule-based: `formalizeShell` turns the script into a
 * link-foundation/meta-language links network, and a `TranslationRuleSet`
 * rewrites that network into a command-stream module. This example shows both
 * the resulting code and the intermediate network.
 */

import { LinkType } from 'meta-language';

import { $ } from '../src/$.mjs';
import { formalizeShell, translateShellToMjs } from '../src/fy/index.mjs';

const script = `#!/bin/sh
set -e

GREETING="hello"
count=$(ls | wc -l)

for name in world there; do
  echo "$GREETING $name"
done

if [ -f package.json ]; then
  echo "found $count entries"
else
  echo "no package.json" && exit 1
fi

cat package.json | grep name
`;

console.log('=== 1. Formalized as a meta-language links network ===\n');
const { network, terms } = formalizeShell(script);
const syntaxLinks = network
  .links()
  .filter((link) => link.metadata().linkType === LinkType.Syntax);
console.log(`${syntaxLinks.length} syntax links using ${terms.size} terms:`);
console.log([...terms].sort().join(', '));

console.log('\n=== 2. Substituted into JavaScript ===\n');
const { code, diagnostics } = translateShellToMjs(script);
console.log(code);

if (diagnostics.length > 0) {
  console.log('=== Diagnostics ===');
  for (const message of new Set(diagnostics)) {
    console.log(`  ${message}`);
  }
}

console.log('=== 3. The same thing through the `$fy` virtual command ===\n');
const translated = await $({
  stdin: 'cd /tmp && pwd',
  mirror: false,
})`$fy --no-shebang`;
console.log(translated.stdout);
