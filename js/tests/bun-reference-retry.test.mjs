import { expect, test } from 'bun:test';
import { runCorpus } from '../../conformance/bun-shell/runner.mjs';

async function probe(
  retryFlaky,
  failUntil,
  filter = 'deno-broken-pipe-subproc'
) {
  let calls = 0;
  const shell = () => {
    const failed = ++calls <= failUntil;
    const result = Promise.resolve({
      exitCode: 0,
      stdout: Buffer.from('hi\n'),
      stderr: Buffer.from(
        failed ? 'grep: write error: Connection reset by peer\n' : ''
      ),
    });
    for (const name of ['cwd', 'env', 'quiet', 'nothrow']) {
      result[name] = () => result;
    }
    return result;
  };
  const counts = await runCorpus({
    $: shell,
    label: 'mock reference',
    which: () => true,
    defaultNode: process.execPath,
    retryFlaky,
    argv: ['--filter', filter, '--concurrency', '1'],
  });
  return { calls, ...counts };
}

test.skipIf(process.platform === 'win32')(
  'known reference failure can pass on a bounded retry',
  async () => {
    expect(await probe(true, 1)).toEqual({
      calls: 2,
      PASS: 1,
      FAIL: 0,
      SKIP: 0,
    });
  }
);

test.skipIf(process.platform === 'win32')(
  'persistent reference failure still fails after four attempts',
  async () => {
    expect(await probe(true, Infinity)).toEqual({
      calls: 4,
      PASS: 0,
      FAIL: 1,
      SKIP: 0,
    });
  }
);

test.skipIf(process.platform === 'win32')(
  'implementations must pass without retries',
  async () => {
    expect(await probe(false, 1)).toEqual({
      calls: 1,
      PASS: 0,
      FAIL: 1,
      SKIP: 0,
    });
  }
);

test.skipIf(process.platform === 'win32')(
  'unmarked reference cases still fail on their first attempt',
  async () => {
    expect(await probe(true, 1, 'deno-broken-pipe-builtin')).toEqual({
      calls: 1,
      PASS: 0,
      FAIL: 1,
      SKIP: 0,
    });
  }
);
