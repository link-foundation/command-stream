import { describe, test } from 'node:test';
import assert from 'node:assert';
import YAML, {
  Alias,
  CST,
  Composer,
  Document,
  Lexer,
  LineCounter,
  Pair,
  Parser,
  Scalar,
  Schema,
  YAMLError,
  YAMLMap,
  YAMLParseError,
  YAMLSeq,
  YAMLWarning,
  isAlias,
  isCollection,
  isDocument,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parse,
  parseAllDocuments,
  parseDocument,
  stringify,
  visit,
  visitAsync,
} from '../../src/zx/vendor/yaml.mjs';

const COMPOSE = `version: "3.9"
services:
  web:
    image: nginx:1.25
    ports:
      - "80:80"
      - 443:443
    environment:
      - DEBUG=false
      - PORT=8080
    depends_on: [db, cache]
  db:
    image: postgres:16 # pinned
    volumes:
      - db-data:/var/lib/postgresql/data
volumes:
  db-data: {}
`;

const WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: npm ci
      - name: Test
        run: |
          npm test
          npm run lint
        env:
          CI: true
`;

describe('vendor/yaml parse: documents', () => {
  test('docker-compose like document', () => {
    assert.deepStrictEqual(parse(COMPOSE), {
      version: '3.9',
      services: {
        web: {
          image: 'nginx:1.25',
          ports: ['80:80', '443:443'],
          environment: ['DEBUG=false', 'PORT=8080'],
          depends_on: ['db', 'cache'],
        },
        db: {
          image: 'postgres:16',
          volumes: ['db-data:/var/lib/postgresql/data'],
        },
      },
      volumes: { 'db-data': {} },
    });
  });

  test('GitHub workflow like document', () => {
    const wf = parse(WORKFLOW);
    assert.deepStrictEqual(Object.keys(wf), ['name', 'on', 'jobs']);
    assert.deepStrictEqual(wf.on, {
      push: { branches: ['main'] },
      pull_request: null,
    });
    const job = wf.jobs.test;
    assert.strictEqual(job['runs-on'], '${{ matrix.os }}');
    assert.deepStrictEqual(job.strategy.matrix, {
      os: ['ubuntu-latest', 'macos-latest'],
      node: [20, 22],
    });
    assert.deepStrictEqual(job.steps[0], { uses: 'actions/checkout@v4' });
    assert.strictEqual(job.steps[2].run, 'npm test\nnpm run lint\n');
    assert.deepStrictEqual(job.steps[2].env, { CI: true });
  });

  test('scalars of the core schema', () => {
    assert.deepStrictEqual(
      parse(
        'a: 1\nb: -2.5\nc: 0x1F\nd: 0o17\ne: 1e3\nf: .inf\ng: -.Inf\n' +
          'h: true\ni: False\nj: null\nk: ~\nl:\nm: yes\nn: 012\n'
      ),
      {
        a: 1,
        b: -2.5,
        c: 31,
        d: 15,
        e: 1000,
        f: Infinity,
        g: -Infinity,
        h: true,
        i: false,
        j: null,
        k: null,
        l: null,
        m: 'yes',
        n: 12,
      }
    );
    assert.ok(Number.isNaN(parse('.nan')));
    assert.strictEqual(parse('plain text'), 'plain text');
    assert.strictEqual(parse(''), null);
    assert.strictEqual(parse('# only a comment\n'), null);
  });

  test('compact sequences of maps and nested sequences', () => {
    assert.deepStrictEqual(parse('- name: a\n  v: 1\n- name: b\n  v: 2\n'), [
      { name: 'a', v: 1 },
      { name: 'b', v: 2 },
    ]);
    assert.deepStrictEqual(parse('- - 1\n  - 2\n- - 3\n'), [[1, 2], [3]]);
    assert.deepStrictEqual(parse('key:\n- a\n- b\n'), { key: ['a', 'b'] });
  });

  test('quoted scalars and escapes', () => {
    assert.deepStrictEqual(
      parse(
        `a: 'it''s'\nb: "tab\\tnew\\nline \\u00e9 \\x41 \\\\"\n` +
          `c: "multi\n  line"\nd: 'fold\n\n  para'\n`
      ),
      {
        a: "it's",
        b: 'tab\tnew\nline \u00e9 A \\',
        c: 'multi line',
        d: 'fold\npara',
      }
    );
  });

  test('multi-line plain scalars fold into one line', () => {
    assert.strictEqual(
      parse('key: one\n  two\n\n  three\n').key,
      'one two\nthree'
    );
  });

  test('comments and document markers', () => {
    assert.deepStrictEqual(
      parse('# head\n---\na: 1 # trailing\n# between\nb: "#not"\n...\n'),
      { a: 1, b: '#not' }
    );
  });

  test('explicit keys and complex keys', () => {
    assert.deepStrictEqual(parse('? a\n: 1\n? b\n'), { a: 1, b: null });
    assert.deepStrictEqual(parse('[1, 2]: x\n', { logLevel: 'silent' }), {
      '[ 1, 2 ]': 'x',
    });
  });
});

describe('vendor/yaml parse: block scalars', () => {
  const cases = [
    ['|\n  a\n  b\n', 'a\nb\n'],
    ['|-\n  a\n  b\n', 'a\nb'],
    ['|+\n  a\n\n\n', 'a\n\n\n'],
    ['>\n  a\n  b\n\n  c\n', 'a b\nc\n'],
    ['>-\n  folded\n  text\n', 'folded text'],
    ['>\n  a\n    indented\n  b\n', 'a\n  indented\nb\n'],
    ['|2\n    two extra\n  base\n', '  two extra\nbase\n'],
    ['|1-\n  x\n', ' x'],
    ['| # comment\n  body\n', 'body\n'],
    ['|\n\n  after blank\n', '\nafter blank\n'],
  ];
  for (const [src, expected] of cases) {
    test(`block scalar ${JSON.stringify(src)}`, () => {
      assert.strictEqual(parse(src), expected);
    });
  }

  test('block scalars as mapping values', () => {
    assert.deepStrictEqual(
      parse('script: |\n  echo 1\n  echo 2\nnext: >-\n  a\n  b\n'),
      { script: 'echo 1\necho 2\n', next: 'a b' }
    );
  });
});

describe('vendor/yaml parse: anchors, merge keys and flow', () => {
  test('anchors and aliases', () => {
    const res = parse('base: &b\n  x: 1\ncopy: *b\nlist: [&v 5, *v]\n');
    assert.deepStrictEqual(res, {
      base: { x: 1 },
      copy: { x: 1 },
      list: [5, 5],
    });
    assert.strictEqual(res.base, res.copy);
  });

  test('merge keys', () => {
    const src =
      'defaults: &d\n  adapter: pg\n  host: localhost\n' +
      'dev:\n  <<: *d\n  database: dev\n  host: devhost\n';
    assert.deepStrictEqual(parse(src, { merge: true }).dev, {
      adapter: 'pg',
      host: 'devhost',
      database: 'dev',
    });
    assert.deepStrictEqual(
      parse('a: &a {x: 1}\nb: &b {y: 2}\nc:\n  <<: [*a, *b]\n', {
        merge: true,
      }).c,
      { x: 1, y: 2 }
    );
  });

  test('flow collections', () => {
    assert.deepStrictEqual(
      parse('{a: 1, b: [x, "y", {c: d}], e: {}, f: [], g: {h}}'),
      { a: 1, b: ['x', 'y', { c: 'd' }], e: {}, f: [], g: { h: null } }
    );
    assert.deepStrictEqual(parse('[a, b,]'), ['a', 'b']);
    assert.deepStrictEqual(parse('[\n  1,\n  2\n]\n'), [1, 2]);
    assert.deepStrictEqual(parse('[a: 1, b]'), [{ a: 1 }, 'b']);
  });

  test('tags', () => {
    assert.deepStrictEqual(
      parse('a: !!str 123\nb: !!int "42"\nc: !!float "1.5"\n'),
      {
        a: '123',
        b: 42,
        c: 1.5,
      }
    );
    assert.deepStrictEqual(parse('!!str true'), 'true');
    assert.deepStrictEqual(
      parse('!custom value', { logLevel: 'silent' }),
      'value'
    );
  });

  test('parse reviver and options', () => {
    const res = parse('a: 1\nb: 2\n', (key, value) =>
      typeof value === 'number' ? value * 10 : value
    );
    assert.deepStrictEqual(res, { a: 10, b: 20 });
    const map = parse('a: 1\n', { mapAsMap: true });
    assert.ok(map instanceof Map);
    assert.strictEqual(map.get('a'), 1);
    assert.strictEqual(
      parse('n: 9007199254740993\n', { intAsBigInt: true }).n,
      9007199254740993n
    );
  });

  test('parseAllDocuments', () => {
    const docs = parseAllDocuments('---\na: 1\n---\nb: 2\n...\n---\n- c\n');
    assert.strictEqual(docs.length, 3);
    assert.deepStrictEqual(
      docs.map((d) => d.toJS()),
      [{ a: 1 }, { b: 2 }, ['c']]
    );
    assert.ok(docs.every(isDocument));
    const empty = parseAllDocuments('');
    assert.strictEqual(empty.length, 0);
    assert.strictEqual(empty.empty, true);
  });
});

function parseError(src) {
  try {
    parse(src);
  } catch (error) {
    return error;
  }
  return assert.fail(`expected ${JSON.stringify(src)} to throw`);
}

describe('vendor/yaml parse: errors', () => {
  test('multiple documents make parse() throw', () => {
    const err = parseError('a: 1\n---\nb: 2\n');
    assert.ok(err instanceof YAMLParseError);
    assert.ok(err instanceof YAMLError);
    assert.strictEqual(err.code, 'MULTIPLE_DOCS');
    assert.strictEqual(err.name, 'YAMLParseError');
  });

  test('bad indentation', () => {
    const err = parseError('a:\n  b: 1\n c: 2\n');
    assert.ok(err instanceof YAMLParseError);
    assert.ok(['BAD_INDENT', 'UNEXPECTED_TOKEN'].includes(err.code), err.code);
    assert.strictEqual(err.linePos[0].line, 3);
  });

  test('unclosed double quote', () => {
    const err = parseError('a: "unclosed\n');
    assert.strictEqual(err.code, 'MISSING_CHAR');
    assert.deepStrictEqual(err.pos, [13, 14]);
    assert.deepStrictEqual(err.linePos[0], { line: 2, col: 1 });
    assert.match(err.message, /quote/);
  });

  test('unclosed single quote', () => {
    assert.strictEqual(parseError("a: 'x\n").code, 'MISSING_CHAR');
  });

  test('unclosed flow collections', () => {
    const map = parseError('{a: 1');
    assert.strictEqual(map.code, 'MISSING_CHAR');
    assert.deepStrictEqual(map.pos, [5, 6]);
    assert.deepStrictEqual(map.linePos[0], { line: 1, col: 6 });
    const seq = parseError('a: [1, 2\n');
    assert.strictEqual(seq.code, 'BAD_INDENT');
    assert.deepStrictEqual(seq.linePos[0], { line: 2, col: 1 });
  });

  test('duplicate keys and block value as implicit key', () => {
    const dup = parseError('a: 1\na: 2\n');
    assert.strictEqual(dup.code, 'DUPLICATE_KEY');
    assert.deepStrictEqual(dup.pos, [5, 6]);
    assert.deepStrictEqual(parse('a: 1\na: 2\n', { uniqueKeys: false }), {
      a: 2,
    });
    assert.strictEqual(
      parseError('a: 1\n  b: 2\n').code,
      'BLOCK_AS_IMPLICIT_KEY'
    );
  });

  test('pretty error messages include a code frame', () => {
    const err = parseError('a: "x\n');
    assert.match(err.message, /at line 2, column 1/);
  });

  test('errors are collected on parseDocument', () => {
    const doc = parseDocument('a: [1, 2\n');
    assert.strictEqual(doc.errors.length, 1);
    assert.ok(doc.errors[0] instanceof YAMLParseError);
    assert.throws(() => doc.toString(), /errors/);
  });

  test('unresolved tags produce warnings, not errors', () => {
    const doc = parseDocument('a: !!int x\n');
    assert.strictEqual(doc.errors.length, 0);
    assert.strictEqual(doc.warnings[0].code, 'TAG_RESOLVE_FAILED');
    assert.ok(doc.warnings[0] instanceof YAMLWarning);
  });
});

describe('vendor/yaml stringify', () => {
  test('simple values', () => {
    assert.strictEqual(stringify({ a: 'b' }), 'a: b\n');
    assert.strictEqual(stringify('text'), 'text\n');
    assert.strictEqual(stringify(42), '42\n');
    assert.strictEqual(stringify(null), 'null\n');
    assert.strictEqual(stringify(true), 'true\n');
    assert.strictEqual(stringify([]), '[]\n');
    assert.strictEqual(stringify({}), '{}\n');
    assert.strictEqual(stringify(undefined), undefined);
  });

  test('docker-compose like object', () => {
    const obj = {
      name: 'compose',
      services: {
        web: {
          image: 'nginx:1.25',
          ports: ['80:80', '443:443'],
          environment: { DEBUG: 'false', PORT: '8080' },
        },
      },
    };
    assert.strictEqual(
      stringify(obj),
      'name: compose\nservices:\n  web:\n    image: nginx:1.25\n' +
        '    ports:\n      - 80:80\n      - 443:443\n    environment:\n' +
        '      DEBUG: "false"\n      PORT: "8080"\n'
    );
  });

  test('arrays of mixed values and nested collections', () => {
    assert.strictEqual(
      stringify([1, 'two', true, null, 3.5, { a: [] }, {}]),
      '- 1\n- two\n- true\n- null\n- 3.5\n- a: []\n- {}\n'
    );
    assert.strictEqual(
      stringify({
        nested: [
          [1, 2],
          [3, [4, 5]],
        ],
        objs: [{ a: 1, b: 2 }],
      }),
      'nested:\n  - - 1\n    - 2\n  - - 3\n    - - 4\n      - 5\n' +
        'objs:\n  - a: 1\n    b: 2\n'
    );
  });

  test('string quoting and block scalars', () => {
    const obj = {
      text: 'line1\nline2\n',
      trimmed: 'a\nb',
      keep: 'x\n\n',
      empty: '',
      spaces: ' lead',
      colon: 'a: b',
      hash: 'a #b',
      num: '123',
      bool: 'true',
      nul: 'null',
      star: '*x',
      dash: '- x',
      quote: "it's",
      dq: 'say "hi"',
    };
    assert.strictEqual(
      stringify(obj),
      'text: |\n  line1\n  line2\ntrimmed: |-\n  a\n  b\nkeep: |+\n  x\n\n' +
        'empty: ""\nspaces: " lead"\ncolon: "a: b"\nhash: "a #b"\n' +
        'num: "123"\nbool: "true"\nnul: "null"\nstar: "*x"\ndash: "- x"\n' +
        `quote: it's\ndq: say "hi"\n`
    );
  });

  test('numbers', () => {
    assert.strictEqual(
      stringify({ n: -0, inf: Infinity, nan: NaN, neg: -5, f: 1e21, s: 0.1 }),
      'n: -0\ninf: .inf\nnan: .nan\nneg: -5\nf: 1e+21\ns: 0.1\n'
    );
    assert.strictEqual(
      stringify(12345678901234567890n),
      '12345678901234567890\n'
    );
  });

  test('long strings are folded at lineWidth', () => {
    const long = 'lorem ipsum dolor sit amet '.repeat(6).trim();
    assert.strictEqual(
      stringify({ long }),
      'long: lorem ipsum dolor sit amet lorem ipsum dolor sit amet lorem ipsum dolor\n' +
        '  sit amet lorem ipsum dolor sit amet lorem ipsum dolor sit amet lorem ipsum\n' +
        '  dolor sit amet\n'
    );
    assert.strictEqual(
      stringify({ long }, { lineWidth: 0 }),
      `long: ${long}\n`
    );
  });

  test('options', () => {
    const obj = { a: [1, 2], b: { c: 'd' } };
    assert.strictEqual(
      stringify(obj, { indent: 4 }),
      'a:\n    - 1\n    - 2\nb:\n    c: d\n'
    );
    assert.strictEqual(stringify(obj, null, 4), stringify(obj, { indent: 4 }));
    assert.strictEqual(
      stringify({ a: [1, 2] }, { indentSeq: false }),
      'a:\n- 1\n- 2\n'
    );
    assert.strictEqual(
      stringify({ a: 'b' }, { collectionStyle: 'flow' }),
      '{ a: b }\n'
    );
    assert.strictEqual(
      stringify({ a: 'x y' }, { defaultStringType: 'QUOTE_DOUBLE' }),
      '"a": "x y"\n'
    );
    assert.strictEqual(
      stringify(
        { a: 'x y' },
        { defaultStringType: 'QUOTE_SINGLE', defaultKeyType: 'PLAIN' }
      ),
      "a: 'x y'\n"
    );
    assert.strictEqual(
      stringify({ a: 'b' }, { directives: true }),
      '---\na: b\n'
    );
    assert.strictEqual(stringify({ a: null }, { nullStr: '~' }), 'a: ~\n');
    assert.strictEqual(stringify({ a: true }, { trueStr: 'yes' }), 'a: yes\n');
  });

  test('replacer and undefined values', () => {
    assert.strictEqual(
      stringify({ a: 1, b: 2, c: 3 }, ['a', 'c']),
      'a: 1\nc: 3\n'
    );
    assert.strictEqual(
      stringify({ a: 1, b: 'x' }, (key, value) =>
        typeof value === 'number' ? value + 1 : value
      ),
      'a: 2\nb: x\n'
    );
    assert.strictEqual(stringify({ a: undefined, b: 1 }), 'b: 1\n');
    assert.strictEqual(
      stringify({ a: undefined }, { keepUndefined: true }),
      'a: null\n'
    );
  });

  test('Map, Set and Date values', () => {
    assert.strictEqual(stringify(new Map([['k', 'v']])), 'k: v\n');
    assert.strictEqual(stringify(new Set(['a', 'b'])), '- a\n- b\n');
    assert.strictEqual(
      stringify({ d: new Date('2024-01-02T03:04:05.000Z') }),
      'd: 2024-01-02T03:04:05.000Z\n'
    );
  });

  test('repeated objects become anchors and aliases', () => {
    const shared = { x: 1 };
    const out = stringify({ a: shared, b: shared });
    assert.strictEqual(out, 'a: &a1\n  x: 1\nb: *a1\n');
    const back = parse(out);
    assert.strictEqual(back.a, back.b);
  });
});

describe('vendor/yaml round trips', () => {
  const values = [
    { a: 1, b: [true, false, null], c: { d: 'e', f: [{ g: 'h' }] } },
    ['', ' ', 'a b', '- x', ': y', '#z', '"q"', "'s'", '0x10', '1e3', 'null'],
    { multi: 'line\nbreak', trailing: 'end\n', blank: '\n\nx\n', tab: 'a\tb' },
    { unicode: 'caf\u00e9 \u{1F600}', control: 'bell\x07', crlf: 'a\r\nb' },
    { 'key with spaces': 1, 'key: colon': 2, '': 3, 123: 4, true: 5 },
    { deep: { deeper: { deepest: [[[1]]] } } },
    { long: 'word '.repeat(60).trim(), longQuoted: `"${'x'.repeat(100)}"` },
    [Number.MAX_SAFE_INTEGER, -1.5e-7, 0.000001, 123.456],
    { marker: '---', dots: '...', docish: '--- a\n... b\n' },
  ];
  values.forEach((value, i) => {
    test(`round trip #${i}`, () => {
      assert.deepStrictEqual(parse(stringify(value)), value);
    });
  });

  test('parse -> stringify is stable for block documents', () => {
    const text = stringify(parse(COMPOSE));
    assert.strictEqual(stringify(parse(text)), text);
    assert.deepStrictEqual(parse(text), parse(COMPOSE));
  });

  test('document round trip preserves comments and styles', () => {
    const src =
      '# header\nkey: value # trailing\nquoted: "x"\nsingle: \'y\'\n' +
      'block: |\n  text\nlist:\n  - 1 # one\n  - [ a, b ]\n';
    const doc = parseDocument(src);
    assert.strictEqual(doc.toString(), src);
  });
});

describe('vendor/yaml Document', () => {
  test('contents, toJS, toJSON and toString', () => {
    const doc = parseDocument('a: 1\nb: [x, y]\n');
    assert.ok(isDocument(doc));
    assert.ok(doc instanceof Document);
    assert.ok(isMap(doc.contents));
    assert.deepStrictEqual(doc.toJS(), { a: 1, b: ['x', 'y'] });
    assert.deepStrictEqual(doc.toJSON(), { a: 1, b: ['x', 'y'] });
    assert.strictEqual(doc.toString(), 'a: 1\nb: [ x, y ]\n');
    assert.deepStrictEqual(doc.errors, []);
    assert.deepStrictEqual(doc.warnings, []);
  });

  test('get/set/has/delete helpers', () => {
    const doc = parseDocument('a:\n  b: [1, 2]\n');
    assert.strictEqual(doc.getIn(['a', 'b', 1]), 2);
    assert.ok(doc.hasIn(['a', 'b']));
    doc.setIn(['a', 'c'], 'new');
    doc.set('z', true);
    assert.ok(doc.has('z'));
    assert.ok(doc.deleteIn(['a', 'b']));
    assert.strictEqual(doc.toString(), 'a:\n  c: new\nz: true\n');
    assert.ok(doc.delete('z'));
    assert.deepStrictEqual(doc.toJS(), { a: { c: 'new' } });
  });

  test('new Document from a value', () => {
    const doc = new Document({ list: [1, 2], name: 'x' });
    assert.ok(isMap(doc.contents));
    assert.strictEqual(doc.toString(), 'list:\n  - 1\n  - 2\nname: x\n');
    doc.contents.commentBefore = ' leading';
    assert.match(doc.toString(), /^# leading\n/);
    const empty = new Document();
    assert.strictEqual(empty.contents, null);
    assert.strictEqual(empty.toString(), 'null\n');
  });

  test('createNode, createPair and createAlias', () => {
    const doc = new Document({});
    const node = doc.createNode(['a']);
    assert.ok(isSeq(node));
    const pair = doc.createPair('k', 'v');
    assert.ok(isPair(pair));
    doc.contents.items.push(pair);
    doc.set('list', node);
    const alias = doc.createAlias(node, 'items');
    assert.ok(isAlias(alias));
    doc.set('again', alias);
    assert.strictEqual(
      doc.toString(),
      'k: v\nlist: &items\n  - a\nagain: *items\n'
    );
  });

  test('stringify accepts a Document', () => {
    const doc = parseDocument('# c\nkey: value\n');
    assert.strictEqual(stringify(doc), '# c\nkey: value\n');
  });

  test('directives and multiple documents', () => {
    const doc = parseDocument('%YAML 1.1\n---\na: yes\n');
    assert.strictEqual(doc.toJS().a, true);
    assert.strictEqual(doc.toString(), '%YAML 1.1\n---\na: yes\n');
    const multi = parseDocument('a: 1\n---\nb: 2\n');
    assert.strictEqual(multi.errors[0].code, 'MULTIPLE_DOCS');
  });

  test('keepSourceTokens-free nodes carry ranges', () => {
    const doc = parseDocument('key: value\n');
    const pair = doc.contents.items[0];
    assert.deepStrictEqual(pair.key.range.slice(0, 2), [0, 3]);
    assert.deepStrictEqual(pair.value.range.slice(0, 2), [5, 10]);
  });

  test('scalar styles are exposed on nodes', () => {
    const doc = parseDocument('a: "x"\nb: \'y\'\nc: |\n  z\nd: >\n  w\ne: p\n');
    const types = doc.contents.items.map((p) => p.value.type);
    assert.deepStrictEqual(types, [
      'QUOTE_DOUBLE',
      'QUOTE_SINGLE',
      'BLOCK_LITERAL',
      'BLOCK_FOLDED',
      'PLAIN',
    ]);
    doc.get('e', true).type = 'QUOTE_DOUBLE';
    assert.match(doc.toString(), /e: "p"/);
  });
});

describe('vendor/yaml visit', () => {
  const src = 'a: 1\nb:\n  - x\n  - y\n  - z\nc: {d: 2}\n';

  test('visits every node with keys and paths', () => {
    const seen = [];
    visit(parseDocument(src), (key, node, path) => {
      if (isScalar(node)) {
        seen.push(`${key}:${node.value}:${path.length}`);
      }
    });
    assert.deepStrictEqual(seen, [
      'key:a:3',
      'value:1:3',
      'key:b:3',
      '0:x:4',
      '1:y:4',
      '2:z:4',
      'key:c:3',
      'key:d:5',
      'value:2:5',
    ]);
  });

  test('BREAK stops the traversal', () => {
    const seen = [];
    visit(parseDocument(src), {
      Scalar(key, node) {
        seen.push(node.value);
        return node.value === 'x' ? visit.BREAK : undefined;
      },
    });
    assert.deepStrictEqual(seen, ['a', 1, 'b', 'x']);
  });

  test('SKIP skips children', () => {
    const seen = [];
    visit(parseDocument(src), {
      Seq: () => visit.SKIP,
      Scalar(_key, node) {
        seen.push(node.value);
      },
    });
    assert.deepStrictEqual(seen, ['a', 1, 'b', 'c', 'd', 2]);
  });

  test('REMOVE deletes items and pairs', () => {
    const doc = parseDocument(src);
    visit(doc, {
      Scalar(_key, node) {
        return node.value === 'y' ? visit.REMOVE : undefined;
      },
      Pair(_key, pair) {
        return pair.key.value === 'c' ? visit.REMOVE : undefined;
      },
    });
    assert.deepStrictEqual(doc.toJS(), { a: 1, b: ['x', 'z'] });
  });

  test('returning a node replaces it', () => {
    const doc = parseDocument(src);
    visit(doc, {
      Scalar(_key, node) {
        if (typeof node.value === 'number') {
          return new Scalar(`n${node.value}`);
        }
        return undefined;
      },
    });
    assert.deepStrictEqual(doc.toJS().c, { d: 'n2' });
    assert.strictEqual(doc.toJS().a, 'n1');
  });

  test('visitAsync supports async visitors and control symbols', async () => {
    const doc = parseDocument(src);
    const seen = [];
    await visitAsync(doc, {
      async Scalar(_key, node) {
        await Promise.resolve();
        seen.push(node.value);
        if (node.value === 'y') {
          return visitAsync.REMOVE;
        }
        return node.value === 'c' ? visitAsync.BREAK : undefined;
      },
    });
    assert.deepStrictEqual(seen, ['a', 1, 'b', 'x', 'y', 'z', 'c']);
    assert.deepStrictEqual(doc.toJS().b, ['x', 'z']);
    assert.strictEqual(typeof visitAsync.SKIP, 'symbol');
  });
});

describe('vendor/yaml streaming classes', () => {
  const src = 'a: 1 # c\nb: [x, y]\n---\n- z\n';

  test('Lexer.lex yields lossless string tokens', () => {
    const tokens = [...new Lexer().lex(src)];
    assert.ok(tokens.length > 5);
    assert.ok(tokens.every((t) => typeof t === 'string'));
    assert.strictEqual(tokens.join(''), src);
  });

  test('Parser.parse yields CST tokens and reports new lines', () => {
    const lines = [];
    const tokens = [...new Parser((offset) => lines.push(offset)).parse(src)];
    assert.ok(tokens.length >= 2);
    assert.ok(tokens.every((t) => typeof t.type === 'string'));
    assert.strictEqual(tokens.map((t) => CST.stringify(t)).join(''), src);
    assert.deepStrictEqual(lines.slice(0, 3), [0, 9, 19]);
  });

  test('Composer.compose yields Documents', () => {
    const tokens = new Parser().parse(src);
    const docs = [...new Composer().compose(tokens)];
    assert.strictEqual(docs.length, 2);
    assert.ok(docs.every(isDocument));
    assert.deepStrictEqual(docs[0].toJS(), { a: 1, b: ['x', 'y'] });
    assert.deepStrictEqual(docs[1].toJS(), ['z']);
    const forced = [...new Composer().compose([], true)];
    assert.strictEqual(forced.length, 1);
  });

  test('LineCounter maps offsets to 1-based line/col', () => {
    const lc = new LineCounter();
    parseDocument('a: 1\nbb: 2\nccc: 3\n', { lineCounter: lc });
    assert.deepStrictEqual(lc.linePos(0), { line: 1, col: 1 });
    assert.deepStrictEqual(lc.linePos(5), { line: 2, col: 1 });
    assert.deepStrictEqual(lc.linePos(9), { line: 2, col: 5 });
    const manual = new LineCounter();
    manual.addNewLine(0);
    manual.addNewLine(10);
    assert.deepStrictEqual(manual.linePos(12), { line: 2, col: 3 });
  });

  test('CST helpers', () => {
    assert.strictEqual(typeof CST.visit, 'function');
    assert.strictEqual(typeof CST.visit.BREAK, 'symbol');
    assert.ok(CST.isScalar({ type: 'scalar' }));
    assert.ok(CST.isCollection({ type: 'block-map' }));
    assert.strictEqual(CST.isScalar(null), false);
  });
});

describe('vendor/yaml node classes and predicates', () => {
  test('exports and default export', () => {
    const names = [
      'Alias',
      'CST',
      'Composer',
      'Document',
      'Lexer',
      'LineCounter',
      'Pair',
      'Parser',
      'Scalar',
      'Schema',
      'YAMLError',
      'YAMLMap',
      'YAMLParseError',
      'YAMLSeq',
      'YAMLWarning',
      'isAlias',
      'isCollection',
      'isDocument',
      'isMap',
      'isNode',
      'isPair',
      'isScalar',
      'isSeq',
      'parse',
      'parseAllDocuments',
      'parseDocument',
      'stringify',
      'visit',
      'visitAsync',
    ];
    for (const name of names) {
      assert.ok(YAML[name], `default export has ${name}`);
    }
    assert.strictEqual(YAML.parse, parse);
    assert.strictEqual(YAML.stringify, stringify);
  });

  test('predicates', () => {
    const doc = parseDocument('m: {a: 1}\ns: [&x 1, *x]\n');
    const map = doc.get('m');
    const seq = doc.get('s');
    const [scalar, alias] = seq.items;
    const pair = doc.contents.items[0];
    assert.ok(isMap(map) && isCollection(map) && isNode(map));
    assert.ok(isSeq(seq) && isCollection(seq) && !isMap(seq));
    assert.ok(isScalar(scalar) && isNode(scalar) && !isCollection(scalar));
    assert.ok(isAlias(alias) && isNode(alias) && !isScalar(alias));
    assert.ok(isPair(pair) && !isNode(pair));
    assert.ok(isDocument(doc) && !isNode(doc));
    for (const fn of [isAlias, isCollection, isDocument, isMap, isNode]) {
      assert.strictEqual(fn(null), false);
      assert.strictEqual(fn({}), false);
    }
    assert.strictEqual(isPair('x'), false);
    assert.strictEqual(isScalar(1), false);
    assert.strictEqual(isSeq([]), false);
  });

  test('node constructors', () => {
    assert.ok(new YAMLMap() instanceof YAMLMap);
    assert.ok(new YAMLSeq() instanceof YAMLSeq);
    assert.strictEqual(new Scalar('v').value, 'v');
    assert.strictEqual(new Alias('a').source, 'a');
    const pair = new Pair('k', 'v');
    assert.strictEqual(pair.key, 'k');
    assert.strictEqual(pair.value, 'v');
    assert.ok(new Schema({}) instanceof Schema);
  });

  test('building a tree by hand', () => {
    const doc = new Document();
    const seq = new YAMLSeq();
    seq.add(new Scalar('one'));
    seq.add(2);
    const map = new YAMLMap();
    map.add(new Pair(new Scalar('list'), seq));
    map.set('flag', true);
    doc.contents = map;
    assert.strictEqual(doc.toString(), 'list:\n  - one\n  - 2\nflag: true\n');
    assert.deepStrictEqual(map.toJSON(), { list: ['one', 2], flag: true });
    seq.flow = true;
    assert.strictEqual(doc.toString(), 'list: [ one, 2 ]\nflag: true\n');
  });

  test('error classes', () => {
    const err = new YAMLParseError([1, 2], 'BAD_INDENT', 'msg');
    assert.ok(err instanceof YAMLError);
    assert.ok(err instanceof Error);
    assert.strictEqual(err.code, 'BAD_INDENT');
    assert.deepStrictEqual(err.pos, [1, 2]);
    const warning = new YAMLWarning([0, 1], 'TAG_RESOLVE_FAILED', 'w');
    assert.strictEqual(warning.name, 'YAMLWarning');
    assert.ok(warning instanceof YAMLError);
  });
});
