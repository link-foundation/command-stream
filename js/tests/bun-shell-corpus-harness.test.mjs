// The conformance corpus harness (conformance/bun-shell/corpus.mjs): the
// platform-dependent expectation forms, which CI only exercises on the
// platform it runs on.

import { test, expect, describe } from 'bun:test';
import {
  forPlatform,
  makeContext,
  matchText,
  subst,
  substRegex,
} from '../../conformance/bun-shell/corpus.mjs';

describe('corpus harness', () => {
  test('{{TEMP_NATIVE}} uses the platform separator, {{TEMP}} forward slashes', () => {
    const win = makeContext({ tempDir: 'C:\\t\\x', sep: '\\' });
    expect(subst('{{TEMP}}|{{TEMP_NATIVE}}{{SEP}}a/b', win)).toBe(
      'C:/t/x|C:\\t\\x\\a/b'
    );
    const posix = makeContext({ tempDir: '/t/x', sep: '/' });
    expect(subst('{{TEMP_NATIVE}}', posix)).toBe('/t/x');
  });

  test('regex placeholders match their values literally', () => {
    const ctx = makeContext({ tempDir: 'C:\\t.x(1)', sep: '\\' });
    const re = new RegExp(substRegex('^{{TEMP_NATIVE}}{{SEP}}a$', ctx));
    expect(re.test('C:\\t.x(1)\\a')).toBe(true);
    expect(re.test('C:\\tXx(1)\\a')).toBe(false);
    expect(matchText('C:/t.x(1)/b', { regex: '^{{TEMP}}/b$' }, ctx)).toBeNull();
  });

  test('{{TEMP_NATIVE_JSON}} is the native temp dir escaped for JSON', () => {
    const win = makeContext({ tempDir: 'C:\\t\\x', sep: '\\' });
    expect(subst('"{{TEMP_NATIVE_JSON}}"', win)).toBe('"C:\\\\t\\\\x"');
    expect(JSON.parse(subst('"{{TEMP_NATIVE_JSON}}"', win))).toBe('C:\\t\\x');
  });

  test('byPlatform picks the exact platform, then the family, then default', () => {
    const map = { win32: 'w', posix: 'p', default: 'd' };
    expect(forPlatform(map, 'win32')).toBe('w');
    expect(forPlatform(map, 'darwin')).toBe('p');
    expect(forPlatform({ linux: 'l', default: 'd' }, 'darwin')).toBe('d');
    expect(() => forPlatform({ windows: 'w' }, 'linux')).toThrow(
      'byPlatform has no entry for linux'
    );
  });

  test('matchText resolves byPlatform against the context platform', () => {
    const exp = {
      byPlatform: { windows: { contains: 'C:' }, posix: '/x' },
    };
    const on = (platform) => makeContext({ tempDir: '/t', platform });
    expect(matchText('C:/t', exp, on('win32'))).toBeNull();
    expect(matchText('/x', exp, on('linux'))).toBeNull();
    expect(matchText('C:/t', exp, on('linux'))).toBe(
      'expected "/x", got "C:/t"'
    );
  });
});
