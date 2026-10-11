#!/usr/bin/env node
// Write multiline text exactly, including shell metacharacters (issue #37).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $ } from '../src/$.mjs';

const content = `# Generated file

Literal values stay literal: \`backticks\`, $HOME, \${name}, "quotes",
'apostrophes', and C:\\Program Files\\Example.`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiline example '));
const printfFile = path.join(dir, 'written with printf.md');
const stdinFile = path.join(dir, 'written through stdin.md');

try {
  await $({ mirror: false })`printf '%s' ${content} > ${printfFile}`;
  await $({ mirror: false, stdin: content })`cat > ${stdinFile}`;

  assert.equal(fs.readFileSync(printfFile, 'utf8'), content);
  assert.equal(fs.readFileSync(stdinFile, 'utf8'), content);
  console.log('Both files preserve the multiline content exactly.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
