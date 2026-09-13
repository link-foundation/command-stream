// Multiline interpolation regression coverage (issue #37).
//
// Interpolated text is data, not shell source. These tests exercise the full
// report payload through echo, printf, redirection, a nested program, and an
// injection attempt. The parity table compares command-stream with a quoted
// variable in /bin/sh, which is the intended contract.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { $ } from '../src/$.mjs';
import './test-helper.mjs';

const isWindows = process.platform === 'win32';

const COMPLEX_CONTENT = `# Test Repository

This is a test repository with \`backticks\` and "quotes".

## Code Example
\`\`\`javascript
const message = "Hello, World!";
console.log(\`Message: \${message}\`);
\`\`\`

## Special Characters
- Single quotes: 'test'
- Double quotes: "test"
- Backticks: \`test\`
- Dollar signs: $100
- Backslashes: C:\\Windows\\System32`;

function templateFrom(text) {
  const parts = text.split('\0');
  return Object.assign(parts, { raw: parts });
}

let workDir;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiline content '));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

test.skipIf(isWindows)(
  'echo preserves the full issue #37 payload and adds its normal newline',
  async () => {
    const result = await $({ mirror: false })`echo "${COMPLEX_CONTENT}"`;

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${COMPLEX_CONTENT}\n`);
  }
);

test.skipIf(isWindows)(
  'printf preserves multiline content without adding a newline',
  async () => {
    const printed = await $({ mirror: false })`printf '%s' ${COMPLEX_CONTENT}`;

    expect(printed.stdout).toBe(COMPLEX_CONTENT);
  }
);

test.skipIf(isWindows)(
  'redirection and append preserve content at a path containing spaces',
  async () => {
    const target = path.join(workDir, 'generated README.md');
    const stdinTarget = path.join(workDir, 'generated from stdin.md');

    const write = await $({
      mirror: false,
    })`printf '%s' ${COMPLEX_CONTENT} > ${target}`;
    const append = await $({
      mirror: false,
    })`printf '%s' ${'\nAPPENDED `$HOME` \\tail'} >> ${target}`;
    const stdinWrite = await $({
      mirror: false,
      stdin: COMPLEX_CONTENT,
    })`cat > ${stdinTarget}`;

    expect(write.code).toBe(0);
    expect(append.code).toBe(0);
    expect(stdinWrite.code).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe(
      `${COMPLEX_CONTENT}\nAPPENDED \`$HOME\` \\tail`
    );
    expect(fs.readFileSync(stdinTarget, 'utf8')).toBe(COMPLEX_CONTENT);
  }
);

test.skipIf(isWindows)(
  'the reported echo redirection form writes literal data',
  async () => {
    const target = path.join(workDir, 'echo output.md');
    const result = await $({
      mirror: false,
    })`echo "${COMPLEX_CONTENT}" > ${target}`;

    expect(result.code).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe(`${COMPLEX_CONTENT}\n`);
  }
);

test.skipIf(isWindows)(
  'a multiline node -e program remains one executable argument',
  async () => {
    const script = `
const content = ${JSON.stringify(COMPLEX_CONTENT)};
process.stdout.write(content);
`;
    const result = await $({
      mirror: false,
    })`node --input-type=module -e ${script}`;

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(COMPLEX_CONTENT);
  }
);

test.skipIf(isWindows)(
  'multiline shell syntax cannot escape interpolation and run a command',
  async () => {
    const marker = path.join(workDir, 'injected');
    const value = `first line
"; touch ${marker}; echo "
$(touch ${marker})
\`touch ${marker}\``;
    const result = await $({ mirror: false })`printf '%s' ${value}`;

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(value);
    expect(fs.existsSync(marker)).toBe(false);
  }
);

for (const [name, commandStreamScript, shScript] of [
  ['echo in author quotes', 'echo "\0"', 'echo "$V"'],
  ['echo -n', 'echo -n \0', 'echo -n "$V"'],
  ['printf exact text', "printf '%s' \0", `printf '%s' "$V"`],
]) {
  test.skipIf(isWindows)(`matches /bin/sh: ${name}`, async () => {
    const reference = spawnSync('/bin/sh', ['-c', shScript], {
      encoding: 'utf8',
      env: { ...process.env, V: COMPLEX_CONTENT },
    });
    const result = await $({ mirror: false })(
      templateFrom(commandStreamScript),
      COMPLEX_CONTENT
    );

    expect(result.code).toBe(reference.status);
    expect(result.stdout).toBe(reference.stdout);
  });
}
