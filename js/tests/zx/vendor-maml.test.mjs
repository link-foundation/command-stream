import { describe, test } from 'node:test';
import assert from 'node:assert';
import maml, { parse, stringify } from '../../src/zx/vendor/maml.mjs';

const EXAMPLE = `{
  project: "MAML"
  tags: [
    "minimal"
    "readable"
  ]

  # A simple nested object
  spec: {
    version: 1
    author: "Anton Medvedev"
  }

  notes: """
This is a multiline string.
Keeps formatting as‑is.
"""
}`;

const EXAMPLE_OBJECT = {
  project: 'MAML',
  tags: ['minimal', 'readable'],
  spec: { version: 1, author: 'Anton Medvedev' },
  notes: 'This is a multiline string.\nKeeps formatting as‑is.\n',
};

function syntaxError(src) {
  try {
    parse(src);
  } catch (error) {
    return error;
  }
  return assert.fail(`expected ${JSON.stringify(src)} to throw`);
}

describe('vendor/maml parse', () => {
  test('spec example', () => {
    assert.deepStrictEqual(parse(EXAMPLE), EXAMPLE_OBJECT);
  });

  test('default export', () => {
    assert.strictEqual(maml.parse, parse);
    assert.strictEqual(maml.stringify, stringify);
  });

  test('primitives', () => {
    assert.strictEqual(parse('true'), true);
    assert.strictEqual(parse('false'), false);
    assert.strictEqual(parse('null'), null);
    assert.strictEqual(parse('42'), 42);
    assert.strictEqual(parse('-0.5e2'), -50);
    assert.strictEqual(parse('0'), 0);
    assert.strictEqual(parse(' "text" '), 'text');
  });

  test('keys: identifiers and quoted strings', () => {
    assert.deepStrictEqual(
      parse('{ a-b_1: 1, 123: 2, "with space": 3, "": 4 }'),
      { 'a-b_1': 1, 123: 2, 'with space': 3, '': 4 }
    );
  });

  test('commas, newlines and trailing commas', () => {
    assert.deepStrictEqual(parse('[1, 2, 3,]'), [1, 2, 3]);
    assert.deepStrictEqual(parse('[\n  1\n  2,\n  3,\n]'), [1, 2, 3]);
    assert.deepStrictEqual(parse('{a: 1, b: 2,}'), { a: 1, b: 2 });
    assert.deepStrictEqual(
      parse('{\n  a: 1\n  b: [x]\n}'.replace('x', '"x"')),
      {
        a: 1,
        b: ['x'],
      }
    );
    assert.deepStrictEqual(parse('[]'), []);
    assert.deepStrictEqual(parse('{}'), {});
    assert.deepStrictEqual(parse('{\n}'), {});
  });

  test('comments', () => {
    assert.deepStrictEqual(
      parse('# top\n{\n  a: 1 # trailing\n  # alone\n  b: "#not"\n}\n# end'),
      { a: 1, b: '#not' }
    );
  });

  test('string escapes', () => {
    assert.strictEqual(
      parse(String.raw`"q\" b\\ s\/ \b\f\n\r\t é \u{1F600}"`),
      'q" b\\ s/ \b\f\n\r\t é \u{1F600}'
    );
  });

  test('raw multiline strings', () => {
    assert.strictEqual(
      parse('"""\nline 1\n  line 2\n"""'),
      'line 1\n  line 2\n'
    );
    assert.strictEqual(parse('"""raw \\n kept"""'), 'raw \\n kept');
    assert.strictEqual(parse('"""\n"""'), '');
    assert.deepStrictEqual(parse('{ s: """\n  a\n  b""" }'), { s: '  a\n  b' });
  });

  test('nested structures', () => {
    assert.deepStrictEqual(
      parse('{ list: [ { a: [ [] ] }, null, true ], obj: { x: { y: -1 } } }'),
      { list: [{ a: [[]] }, null, true], obj: { x: { y: -1 } } }
    );
  });

  test('__proto__ keys are own properties', () => {
    const obj = parse('{ __proto__: 1 }');
    assert.ok(Object.prototype.hasOwnProperty.call(obj, '__proto__'));
    assert.strictEqual(Object.getPrototypeOf(obj), Object.prototype);
  });
});

describe('vendor/maml parse errors', () => {
  const cases = [
    ['{a: 1 b: 2}', 1, /Unexpected "b"/],
    ['[1,,2]', 1, /Unexpected ","/],
    ['{\n  "a": "x\n}', 2, /Unterminated string/],
    ['{\n  a 1\n}', 2, /Expected ":"/],
    ['nope', 1, /Unexpected "nope"/],
    ['[1', 1, /end of input/],
    ['{\n  s: """abc\n}', 2, /Unterminated multiline string/],
    ['{a: 1, a: 2}', 1, /Duplicate key "a"/],
    ['', 1, /end of input/],
    ['1 2', 1, /Unexpected "2"/],
    ['"bad \\q"', 1, /Invalid escape/],
    ['"\\u12"', 1, /Invalid unicode escape/],
    ['01', 1, /Unexpected "01"/],
    ['{a: 1}\n\n}', 3, /Unexpected "}"/],
  ];
  for (const [src, line, message] of cases) {
    test(`rejects ${JSON.stringify(src)}`, () => {
      const err = syntaxError(src);
      assert.ok(err instanceof SyntaxError);
      assert.match(err.message, message);
      assert.match(err.message, new RegExp(`on line ${line}$`));
      assert.strictEqual(err.line, line);
      assert.strictEqual(typeof err.column, 'number');
    });
  }

  test('non-string input', () => {
    assert.throws(() => parse(42), TypeError);
  });
});

describe('vendor/maml stringify', () => {
  test('spec example output', () => {
    assert.strictEqual(
      stringify(EXAMPLE_OBJECT),
      '{\n  project: "MAML"\n  tags: [\n    "minimal"\n    "readable"\n  ]\n' +
        '  spec: {\n    version: 1\n    author: "Anton Medvedev"\n  }\n' +
        '  notes: """\nThis is a multiline string.\nKeeps formatting as‑is.\n"""\n}'
    );
  });

  test('primitives and empty collections', () => {
    assert.strictEqual(stringify(null), 'null');
    assert.strictEqual(stringify(true), 'true');
    assert.strictEqual(stringify(1.5), '1.5');
    assert.strictEqual(stringify(NaN), 'null');
    assert.strictEqual(stringify('a"b'), '"a\\"b"');
    assert.strictEqual(stringify([]), '[]');
    assert.strictEqual(stringify({}), '{}');
    assert.strictEqual(stringify(undefined), undefined);
  });

  test('keys are quoted only when needed', () => {
    assert.strictEqual(
      stringify({ plain_key: 1, 'with space': 2, 'a.b': 3 }),
      '{\n  plain_key: 1\n  "with space": 2\n  "a.b": 3\n}'
    );
  });

  test('multiline strings fall back to JSON when unsafe for """', () => {
    assert.strictEqual(stringify('a\nb'), '"""\na\nb"""');
    assert.strictEqual(stringify('x\n"""\ny'), '"x\\n\\"\\"\\"\\ny"');
    assert.strictEqual(stringify('ends\nwith"'), '"ends\\nwith\\""');
  });

  test('undefined and functions follow JSON semantics', () => {
    assert.strictEqual(
      stringify({ a: undefined, b: () => 1, c: [undefined] }),
      '{\n  c: [\n    null\n  ]\n}'
    );
    assert.strictEqual(
      stringify({ d: new Date('2024-01-02T00:00:00.000Z') }),
      '{\n  d: "2024-01-02T00:00:00.000Z"\n}'
    );
  });

  test('circular structures throw', () => {
    const obj = {};
    obj.self = obj;
    assert.throws(() => stringify(obj), TypeError);
  });

  test('round trips', () => {
    const values = [
      EXAMPLE_OBJECT,
      { nested: { deep: [[1, [2, { x: 'y' }]]] }, empty: { a: [], b: {} } },
      ['a\nb', 'tab\there', 'quote"', 'unicode é \u{1F600}', '', '\n'],
      { 'weird key!': -1.25e-7, 'k-e_y': false, n: null },
      { multi: 'first\n\n  indented\nlast', trailing: 'x\n\n' },
    ];
    for (const value of values) {
      assert.deepStrictEqual(parse(stringify(value)), value);
    }
  });
});
