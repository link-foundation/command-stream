import { test, expect, describe, beforeEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, shell } from '../src/$.mjs';

// Errors thrown by failing commands expose the exit status under both `code`
// (Node.js `child_process` naming) and `exitCode` (execa, zx, nano-spawn and
// Bun Shell naming), so handlers written for either convention work (issue #38).
describe('error exitCode alias for error code', () => {
  beforeEach(() => {
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
  });

  test('throws an Error carrying both aliases in errexit mode', async () => {
    shell.errexit(true);

    const error = await $`exit 42`.catch((thrown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('42');
    expect(error.code).toBe(42);
    expect(error.exitCode).toBe(42);
    expect(error.exitCode).toBe(error.code);
  });

  test('keeps both aliases on the attached result', async () => {
    shell.errexit(true);

    const error = await $`exit 7`.catch((thrown) => thrown);

    expect(error.result.code).toBe(7);
    expect(error.result.exitCode).toBe(7);
  });

  test('carries both aliases for every exit status', async () => {
    shell.errexit(true);

    for (const code of [1, 2, 127, 255]) {
      const error = await $`exit ${code}`.catch((thrown) => thrown);

      expect(error.code).toBe(code);
      expect(error.exitCode).toBe(code);
    }
  });

  test('carries both aliases for a failing external command', async () => {
    shell.errexit(true);

    const error = await $`node -e "process.exit(17)"`.catch((thrown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(17);
    expect(error.exitCode).toBe(17);
  });

  test('carries both aliases for a failing pipeline', async () => {
    shell.errexit(true);
    shell.pipefail(true);

    const error = await $`exit 19 | cat`.catch((thrown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(19);
    expect(error.exitCode).toBe(19);
  });

  test('carries both aliases on a failing .pipe() result', async () => {
    shell.errexit(true);

    const result = await $`echo hello`.pipe($`node -e "process.exit(23)"`);

    expect(result.code).toBe(23);
    expect(result.exitCode).toBe(23);
  });

  test('carries both aliases for a missing executable', async () => {
    shell.errexit(true);

    const error = await $`command-stream-missing-binary-38`.catch(
      (thrown) => thrown
    );

    expect(error).toBeInstanceOf(Error);
    expect(typeof error.code).toBe('number');
    expect(error.exitCode).toBe(error.code);
  });

  test('leaves the non-errexit result path unchanged', async () => {
    const result = await $`exit 3`;

    expect(result.code).toBe(3);
    expect(result.exitCode).toBe(3);
  });
});
