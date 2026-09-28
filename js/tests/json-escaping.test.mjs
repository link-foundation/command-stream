// JSON interpolation regression coverage for issue #39.
//
// An interpolated string is data, not shell syntax. This is the same contract
// as "$value" in sh and preserves JSON without JSON-specific detection or
// unescaping.

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';
import { $ } from '../src/$.mjs';
import { isWindows } from './test-helper.mjs';

const ARGV_PRINTER = fileURLToPath(
  new URL('./fixtures/argv-json.mjs', import.meta.url)
);

const ISSUE_DATA = {
  name: 'Test Project',
  description: 'A project with "quotes" and \'apostrophes\'',
  scripts: {
    test: 'echo "Running tests"',
    build: "node build.js --env='production'",
  },
  config: {
    special: 'Value with `backticks` and $variables',
  },
};

const JSON_CASES = [
  ['compact object', JSON.stringify({ name: 'test', enabled: true })],
  ['formatted issue object', JSON.stringify(ISSUE_DATA, null, 2)],
  [
    'arrays and primitives',
    JSON.stringify(['text', 42, false, null, { nested: ['value'] }]),
  ],
  [
    'quotes and backslashes',
    JSON.stringify({
      quote: '"double" and \'single\'',
      windowsPath: 'C:\\Program Files\\command-stream\\config.json',
      escapedSlash: '\\\\server\\share',
    }),
  ],
  [
    'control escapes and unicode',
    JSON.stringify({
      controls: 'line 1\nline 2\tcolumn\rreturn\0null',
      unicode: 'snow 雪 and rocket 🚀',
    }),
  ],
  [
    'shell syntax and printf tokens',
    JSON.stringify({
      syntax: '$HOME `date` $(echo injected); touch nope | cat && false',
      format: '100% complete: %s %b',
    }),
  ],
];

const CONTEXTS = [
  ['unquoted', `node "${ARGV_PRINTER}" \0`],
  ['inside double quotes', `node "${ARGV_PRINTER}" "\0"`],
  ['inside single quotes', `node "${ARGV_PRINTER}" '\0'`],
];

function templateFrom(text) {
  const parts = text.split('\0');
  return Object.assign(parts, { raw: parts });
}

async function inTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'issue-39-json-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [contextName, template] of CONTEXTS) {
  for (const [valueName, json] of JSON_CASES) {
    test.skipIf(isWindows)(
      `${contextName} interpolation passes ${valueName} as one literal argument`,
      async () => {
        const result = await $({ mirror: false })(templateFrom(template), json);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual([json]);
      }
    );
  }
}

test.skipIf(isWindows)(
  "the issue's quoted echo reproduction writes parseable JSON",
  async () => {
    await inTempDir(async (directory) => {
      const json = JSON.stringify(ISSUE_DATA, null, 2);
      const outputFile = path.join(directory, 'package.json');

      await $({ mirror: false })`echo '${json}' > ${outputFile}`;

      expect(JSON.parse(await readFile(outputFile, 'utf8'))).toEqual(
        ISSUE_DATA
      );
    });
  }
);

test.skipIf(isWindows)(
  'printf redirection preserves formatted JSON byte-for-byte',
  async () => {
    await inTempDir(async (directory) => {
      const json = JSON.stringify(ISSUE_DATA, null, 2);
      const outputFile = path.join(directory, 'config with spaces.json');

      await $({ mirror: false })`printf '%s' ${json} > ${outputFile}`;

      expect(await readFile(outputFile, 'utf8')).toBe(json);
    });
  }
);

test.skipIf(isWindows)(
  'JSON remains byte-for-byte intact through a shell pipeline',
  async () => {
    const json = JSON_CASES.find(
      ([name]) => name === 'control escapes and unicode'
    )[1];
    const result = await $({ mirror: false })`printf '%s' ${json} | cat`;

    expect(result.stdout?.toString()).toBe(json);
  }
);

test.skipIf(isWindows)(
  'a keychain-shaped command receives JSON without manual escaping',
  async () => {
    const json = JSON.stringify(ISSUE_DATA);
    const result = await $({
      mirror: false,
    })`node ${ARGV_PRINTER} -w "${json}"`;

    expect(JSON.parse(result.stdout)).toEqual(['-w', json]);
  }
);

test.skipIf(isWindows)(
  'manual quote escaping is preserved as caller data',
  async () => {
    const json = JSON.stringify(ISSUE_DATA);
    const manuallyEscaped = json.replaceAll('"', '\\"');
    const result = await $({
      mirror: false,
    })`node ${ARGV_PRINTER} ${manuallyEscaped}`;
    const [received] = JSON.parse(result.stdout);

    expect(received).toBe(manuallyEscaped);
    expect(received).not.toBe(json);
    expect(() => JSON.parse(received)).toThrow();
  }
);

test.skipIf(isWindows)(
  'shell metacharacters inside JSON cannot execute commands',
  async () => {
    await inTempDir(async (directory) => {
      const marker = path.join(directory, 'injected');
      const outputFile = path.join(directory, 'output.json');
      const json = JSON.stringify({
        payload: [
          '"; touch ',
          marker,
          '; echo "$(touch ',
          marker,
          ')" `touch ',
          marker,
          '`',
        ].join(''),
      });

      await $({ mirror: false })`printf '%s' ${json} > ${outputFile}`;

      expect(await readFile(outputFile, 'utf8')).toBe(json);
      await expect(readFile(marker, 'utf8')).rejects.toThrow();
    });
  }
);

for (const [contextName, template] of CONTEXTS) {
  for (const [valueName, json] of JSON_CASES) {
    test.skipIf(isWindows)(
      `matches /bin/sh "$JSON_VALUE": ${contextName}, ${valueName}`,
      async () => {
        const expected = spawnSync(
          '/bin/sh',
          ['-c', 'printf \'%s\' "$JSON_VALUE"'],
          {
            env: { ...process.env, JSON_VALUE: json },
            encoding: 'utf8',
          }
        );
        const actual = await $({ mirror: false })(
          templateFrom(
            template.replace(`node "${ARGV_PRINTER}"`, "printf '%s'")
          ),
          json
        );

        expect(actual.stdout?.toString()).toBe(expected.stdout);
        expect(actual.code).toBe(expected.status);
      }
    );
  }
}
