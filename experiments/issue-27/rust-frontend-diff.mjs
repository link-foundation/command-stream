// Differential test of the Rust Bun Shell frontend (rust/src/bun_shell/
// {template,lexer,parser}.rs) against the JS port (js/src/bun-shell/).
//
// Inputs: every corpus case template (minus JS-only cases and cases with
// values Rust cannot express), their setup templates, a hand-written list of
// tricky scripts and a seeded random fuzz set. Each input is run through the
// JS template builder + parser and through the Rust ones (via the ignored
// `dump_parse_results` unit test); the built script, jsstrings, jsobjs count
// and AST JSON (or error message) must match exactly.
//
// Run with: node experiments/issue-27/rust-frontend-diff.mjs [fuzzCount] [seed]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  allCases,
  makeContext,
  materializeTemplate,
} from '../../conformance/bun-shell/corpus.mjs';
import { buildShellSource } from '../../js/src/bun-shell/template.mjs';
import { parse } from '../../js/src/bun-shell/parser.mjs';
import { braces } from '../../js/src/bun-shell/braces.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const fuzzCount = Number(process.argv[2] ?? 20000);
let seed = Number(process.argv[3] ?? 1);

class Unsupported extends Error {}

/**
 * Encode a JS template value as the value specs the Rust dump understands,
 * flattened in prefix order (an array is `{array: length}` followed by its
 * items) so that deeply nested arrays stay within serde_json's depth limit.
 */
function spec(v, out = []) {
  if (Array.isArray(v)) {
    out.push({ array: v.length });
    v.forEach((x) => spec(x, out));
  } else {
    out.push(leafSpec(v));
  }
  return out;
}

function leafSpec(v) {
  if (v === null) {
    return null;
  }
  if (v === undefined) {
    return { undefined: true };
  }
  switch (typeof v) {
    case 'string':
      return { str: v };
    case 'boolean':
      return { bool: v };
    case 'bigint':
      return { bigint: String(v) };
    case 'number':
      if (Number.isNaN(v) || !Number.isFinite(v)) {
        return { num: String(v) };
      }
      return { num: Object.is(v, -0) ? '-0' : v };
  }
  if (v instanceof Uint8Array) {
    return { bytes: [...v] };
  }
  if (Object.hasOwn(v, 'raw') && typeof v.raw === 'string') {
    return { raw: v.raw };
  }
  throw new Unsupported(Object.prototype.toString.call(v));
}

function jsTemplateResult(strings, values) {
  let src;
  try {
    src = buildShellSource(strings, values);
  } catch (e) {
    return { error: e.message };
  }
  return {
    script: src.script,
    jsstrings: src.jsstrings,
    jsobjsLen: src.jsobjs.length,
    parsed: jsParseResult(src.script, src.jsstrings, src.jsobjs.length),
  };
}

function jsParseResult(script, jsstrings, jsobjsLen) {
  try {
    return {
      ast: JSON.parse(JSON.stringify(parse(script, jsstrings, jsobjsLen))),
    };
  } catch (e) {
    return { error: e.message };
  }
}

function canonical(v) {
  if (Array.isArray(v)) {
    return v.map(canonical);
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])])
    );
  }
  return v;
}

const inputs = [];
const counts = {
  corpus: 0,
  corpusSkipped: 0,
  handwritten: 0,
  fuzz: 0,
  fuzzTemplates: 0,
  braces: 0,
};

function addTemplate(kind, label, strings, values) {
  let specs;
  try {
    specs = values.flatMap((v) => spec(v));
  } catch (e) {
    if (e instanceof Unsupported) {
      return false;
    }
    throw e;
  }
  inputs.push({
    kind,
    label,
    rust: { strings: [...strings], values: specs },
    js: jsTemplateResult(strings, values),
  });
  counts[kind]++;
  return true;
}

function addScript(kind, script, jsstrings = [], jsobjsLen = 0) {
  inputs.push({
    kind,
    label: script,
    rust: { script, jsstrings, jsobjsLen },
    js: jsParseResult(script, jsstrings, jsobjsLen),
  });
  counts[kind]++;
}

function addBraces(pattern) {
  let js;
  try {
    js = { words: braces(pattern) };
  } catch (e) {
    js = { error: e.message };
  }
  inputs.push({
    kind: 'braces',
    label: pattern,
    rust: { braces: pattern },
    js,
  });
  counts.braces++;
}

// --- Corpus ---------------------------------------------------------------
const ctx = makeContext({
  tempDir: '/tmp/rust-frontend-diff',
  node: 'node',
  sep: '/',
});
const factory = {
  bytes: (s) => Buffer.from(s, 'utf8'),
  outBuffer: ({ size }) => Buffer.alloc(size),
  response: () => new Map(),
  blob: () => new Map(),
  jsfile: () => new Map(),
};
for (const c of allCases()) {
  if (Array.isArray(c.languages) && !c.languages.includes('rust')) {
    counts.corpusSkipped++;
    continue;
  }
  for (const [i, t] of [c, ...(c.setup || [])].entries()) {
    const { strings, values } = materializeTemplate(t, ctx, factory);
    const label = `${c.file}#${c.id ?? c.name ?? '?'}${i ? ` setup${i}` : ''}`;
    if (!addTemplate('corpus', label, strings.raw, values)) {
      counts.corpusSkipped++;
    }
  }
}

// --- Hand-written scripts -------------------------------------------------
const handwritten = [
  '',
  ' ',
  '\n\n',
  'echo hi',
  'echo "a b" \'c d\' e\\ f',
  'echo "$FOO" "${FOO}bar" $1 $? $@ $# $$ $0 $10',
  'echo "unterminated',
  "echo 'unterminated",
  'echo "\\$HOME \\" \\\\ \\a"',
  'echo \\',
  'echo a\\\nb',
  'echo $(echo hi) `echo there` "$(echo q)" "`echo r`"',
  'echo $(echo $(echo $(echo deep)))',
  'echo $(ls',
  'echo `ls',
  'echo )',
  'echo $( )',
  'echo `echo \\`nested\\``',
  'ls 2>&1 | cat',
  'ls 1>&2',
  'ls >&2',
  'ls &> out',
  'ls &>> out',
  'ls >> out',
  'ls > out 2> err',
  'cat < in',
  'ls 2>',
  'ls > > x',
  'ls >',
  'a && b || c; d | e | f',
  'a &&',
  '&& a',
  'a ||| b',
  'a | | b',
  'a ;; b',
  'a &',
  'a & b',
  'if true; then echo y; fi',
  'if true; then echo y; else echo n; fi',
  'if a; then b; elif c; then d; elif e; then f; else g; fi',
  'if a\nthen\nb\nfi',
  'if a; then b',
  'if a; b; fi',
  'if; then; fi',
  'if a; then b; else c',
  'if a; then b; fi; echo after',
  'echo if then fi',
  'fi',
  'then',
  'if a; then if b; then c; fi; fi',
  '[[ -f foo ]]',
  '[[ -z "" ]] && echo empty',
  '[[ -n x ]]',
  '[[ -d dir ]]',
  '[[ -c /dev/null ]]',
  '[[ a == b ]]',
  '[[ a != b ]]',
  '[[ a -eq b ]]',
  '[[ -q x ]]',
  '[[ -e x ]]',
  '[[ -f ]]',
  '[[ a == ]]',
  '[[ a == b',
  '[[ ]]',
  '[[ a ]]',
  '[[a == b]]',
  '(echo a; echo b)',
  '(echo a) | cat',
  '(echo) > f',
  '((echo a))',
  '(',
  '()',
  'echo a (b)',
  '(a) (b)',
  'FOO=bar',
  'FOO=bar BAZ=qux',
  'FOO=bar echo $FOO',
  'FOO=bar BAZ="q x" env',
  '1FOO=bar',
  'FOO==bar',
  '=bar',
  'FOO=',
  'FOO=$(echo x)',
  'FOO=a{b,c}',
  'echo {a,b}',
  'echo {a,b}{c,d}',
  'echo {a,{b,c}}',
  'echo {a}',
  'echo {,}',
  'echo x{a,b',
  'echo }{',
  'echo *.txt',
  'echo **/*.js',
  'echo a*b',
  'echo "*"',
  'echo ?',
  'echo [ab]',
  'echo ~',
  'echo ~/x',
  'echo a~',
  'echo "~"',
  'echo ~user',
  'echo $',
  'echo $$',
  'echo ${',
  'echo ${}',
  'echo ${FOO',
  'echo ${1}',
  'echo $9x',
  'echo é 😂 中文',
  'echo "é😂"',
  'echo\ta\t\tb',
  'echo\r\nb',
  'echo a b',
  'echo # comment',
  'echo a#b',
  'echo \x08',
  'echo \x08__bunstr_0\x08',
  'echo \x08__bun_0\x08',
  'echo \x08__bun_x\x08',
  'echo \x08__bunstr_9\x08',
  'ls )\nls |',
  '('.repeat(128) + 'a' + ')'.repeat(128),
  '('.repeat(129) + 'a' + ')'.repeat(129),
  '$('.repeat(128) + 'a' + ')'.repeat(128),
  '"$('.repeat(60) + 'a' + ')"'.repeat(60),
  'if a; then '.repeat(300) + 'b' + '; fi'.repeat(300),
  'echo "a"b\'c\'d',
  'echo ""',
  "echo ''",
  'echo "" ""',
  'echo a""b',
  'echo "$(echo "inner quoted")"',
  "echo '$(not subst)'",
  'echo "a\nb"',
  'echo $FOO_BAR-baz',
  'echo $FOO.bar',
  'echo ${FOO}_x ${A}${B}',
];
for (const s of handwritten) {
  addScript('handwritten', s);
}
addScript(
  'handwritten',
  'echo \x08__bunstr_0\x08 \x08__bunstr_1\x08',
  ['a b', 'if'],
  0
);
addScript('handwritten', '\x08__bunstr_0\x08 a; then b; fi', ['if'], 0);
addScript('handwritten', 'cat < \x08__bun_0\x08 > \x08__bun_1\x08', [], 2);
addScript('handwritten', 'cat > \x08__bun_0\x08', [], 0);
addScript('handwritten', 'echo x\x08__bunstr_0\x08y', ['é😂 z'], 0);
addScript('handwritten', 'FOO=\x08__bunstr_0\x08 env', ['a b'], 0);

// --- Random fuzz ----------------------------------------------------------
const rand = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rand() * a.length)];
const pieces = [
  'echo',
  ' ',
  ' ',
  ' ',
  'a',
  'b',
  'x=1',
  'FOO=bar',
  '$FOO',
  '${FOO}',
  '${',
  '$1',
  '$?',
  '$@',
  '$',
  '"',
  "'",
  '\\',
  '\\\n',
  '|',
  '||',
  '&&',
  '&',
  ';',
  '\n',
  '(',
  ')',
  '$(',
  '`',
  '{',
  '}',
  ',',
  '*',
  '**',
  '?',
  '[',
  ']',
  '~',
  '#',
  '=',
  '>',
  '>>',
  '<',
  '2>',
  '&>',
  '&>>',
  '2>&1',
  '1>&2',
  '>&2',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  '[[',
  ']]',
  '-f',
  '-z',
  '-n',
  '-d',
  '-c',
  '-e',
  '==',
  '!=',
  '-eq',
  '!',
  'true',
  'false',
  '\t',
  '\r',
  '"a b"',
  "'c d'",
  '\x08',
  'é',
  '😂',
  '中',
  '0',
  '9',
  ':',
  '.',
  '/',
  '-',
  '\x08__bunstr_0\x08',
  '\x08__bun_0\x08',
];
const vals = [
  'a b',
  '',
  'if',
  'then',
  'fi',
  'x',
  '$HOME',
  '1',
  'é😂',
  '*.txt',
  '{a,b}',
  '~',
  "it's",
  'a"b',
  '\\',
  'a\nb',
  'a\x08b',
  'a\0b',
  [1, 'a'],
  [],
  [[['deep']]],
  { raw: '|' },
  { raw: '$(' },
  { raw: ')' },
  { raw: 'if' },
  { raw: '"' },
  Buffer.from('z'),
  3.5,
  -0,
  NaN,
  1e21,
  123n,
  true,
  false,
  null,
  undefined,
];
const fuzzScripts = Math.floor(fuzzCount / 2);
for (let it = 0; it < fuzzScripts; it++) {
  const n = 1 + Math.floor(rand() * 14);
  let s = '';
  for (let k = 0; k < n; k++) {
    s += pick(pieces);
  }
  const nStrings = Math.floor(rand() * 2);
  addScript(
    'fuzz',
    s,
    ['if', 'a b'].slice(0, nStrings),
    Math.floor(rand() * 2)
  );
}
for (let it = 0; it < fuzzCount - fuzzScripts; it++) {
  const nParts = 1 + Math.floor(rand() * 3);
  const raw = [];
  const values = [];
  for (let p = 0; p < nParts; p++) {
    let s = '';
    const n = Math.floor(rand() * 8);
    for (let k = 0; k < n; k++) {
      s += pick(pieces);
    }
    raw.push(s);
    if (p < nParts - 1) {
      values.push(pick(vals));
    }
  }
  addTemplate('fuzzTemplates', JSON.stringify(raw), raw, values);
}

// --- Brace expansion ------------------------------------------------------
for (const p of [
  '',
  'echo 123',
  'echo {123,456}',
  '{a,b}{c,d}',
  '{a}',
  '{}',
  '{,}',
  '{,,}',
  '\\{a,b}',
  '{a\\,b}',
  'a\\',
  '{{d,e}{g,h}}',
  'pre{{a,b}{c,d}}post',
  '{a,{b,c}{d,e},f}',
  '{x,a{,}b}',
  '{x,{a,}}z',
  '{x,{,a}}z',
  '{x,{,}}z',
  'a{b,c{d,}}e',
  'a{b,c{,d}}e',
  '{x,{a,,b}}',
  '{x,{a,b,}}',
  '{{a,},x}',
  'p{q,{r,}{s,}}t',
  'lol {😂,🫵,🤣}',
  '{a,b',
  'a,b}',
  '}{a,b}{',
  '{{a,b}',
  '{a,b}}',
  '{a,{b}',
  '{a,{b,c}',
  '{{{a,b}}}',
  `{1,${Array.from({ length: 15 }, (_, i) => `{${i + 2},`).join('')}{17}${'}'.repeat(16)}`,
  `{${'{a,'.repeat(256)}b${'}'.repeat(256)}`,
  `${'{a,'.repeat(257)}${'}'.repeat(257)}`,
  '{a,b}'.repeat(16),
  '{a,b}'.repeat(17),
  '{a,b,c,d}'.repeat(40),
  `{${'{a,b}'.repeat(17)},c}`,
]) {
  addBraces(p);
}
const braceAtoms = [
  '{',
  '{',
  '}',
  '}',
  ',',
  ',',
  'a',
  'b',
  '\\',
  '\\{',
  '\\,',
  ' ',
  '😂',
  'é',
];
for (let it = 0; it < Math.floor(fuzzCount / 4); it++) {
  const n = 1 + Math.floor(rand() * 16);
  let p = '';
  for (let k = 0; k < n; k++) {
    p += pick(braceAtoms);
  }
  addBraces(p);
}

// --- Run Rust and compare -------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-frontend-diff-'));
const inFile = path.join(tmp, 'in.jsonl');
const outFile = path.join(tmp, 'out.jsonl');
fs.writeFileSync(
  inFile,
  inputs.map((i) => JSON.stringify(i.rust)).join('\n') + '\n'
);
execFileSync(
  'cargo',
  [
    'test',
    '--quiet',
    '--lib',
    'dump_parse_results',
    '--',
    '--ignored',
    '--exact',
    'bun_shell::parser::tests::dump_parse_results',
  ],
  {
    cwd: path.join(ROOT, 'rust'),
    env: {
      ...process.env,
      BUN_SHELL_PARSE_IN: inFile,
      BUN_SHELL_PARSE_OUT: outFile,
    },
    stdio: ['ignore', process.stderr, 'inherit'],
  }
);
const outputs = fs
  .readFileSync(outFile, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
fs.rmSync(tmp, { recursive: true, force: true });
if (outputs.length !== inputs.length) {
  throw new Error(
    `rust produced ${outputs.length} results for ${inputs.length} inputs`
  );
}

const mismatches = {};
const outcomes = { ok: 0, error: 0 };
let shown = 0;
inputs.forEach((input, i) => {
  const want = JSON.stringify(canonical(input.js));
  const got = JSON.stringify(canonical(outputs[i]));
  const parsed = input.js.parsed ?? input.js;
  outcomes['error' in parsed ? 'error' : 'ok']++;
  if (want !== got) {
    mismatches[input.kind] = (mismatches[input.kind] ?? 0) + 1;
    if (shown++ < 20) {
      console.log(
        `MISMATCH [${input.kind}] ${JSON.stringify(input.label).slice(0, 200)}`
      );
      console.log(`  js  : ${want.slice(0, 400)}`);
      console.log(`  rust: ${got.slice(0, 400)}`);
    }
  }
});
console.log('inputs:', counts);
console.log('js outcomes:', outcomes);
const total = Object.values(mismatches).reduce((a, b) => a + b, 0);
console.log(`${inputs.length} inputs, ${total} mismatches`, mismatches);
process.exitCode = total === 0 ? 0 : 1;
