// Final test for issue #135: CI environment should not auto-enable trace
// This test verifies the main fix: CI=true should NOT cause trace logs
import { describe, it, beforeEach } from 'bun:test';
import assert from 'assert';
import { $ } from '../js/src/$.mjs';

describe('Issue #135: CI environment no longer auto-enables trace logs', () => {
  beforeEach(() => {
    // Clean up environment before each test
    delete process.env.COMMAND_STREAM_VERBOSE;
    delete process.env.COMMAND_STREAM_TRACE;
    delete process.env.CI;
  });

  it('should NOT emit trace logs when CI=true (main fix)', async () => {
    process.env.CI = 'true';

    const $silent = $({ mirror: false, capture: true });
    const result = await $silent`echo '{"status":"ok"}'`;

    // Output should be clean JSON without trace logs
    assert.strictEqual(result.stdout.trim(), '{"status":"ok"}');

    // Should be parseable as JSON
    const parsed = JSON.parse(result.stdout);
    assert.deepStrictEqual(parsed, { status: 'ok' });
  });

  it('should allow JSON parsing in CI environment', async () => {
    process.env.CI = 'true';

    const $silent = $({ mirror: false, capture: true });
    const result = await $silent`echo '{"count":42,"items":["a","b","c"]}'`;

    // Should be able to parse complex JSON
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.count, 42);
    assert.deepStrictEqual(parsed.items, ['a', 'b', 'c']);
  });

  it('should NOT produce trace logs by default (no env vars)', async () => {
    const $silent = $({ mirror: false, capture: true });
    const result = await $silent`echo test`;

    // Simple text output should be clean
    assert.strictEqual(result.stdout.trim(), 'test');
  });

  it('should work with mirror:false in CI environment', async () => {
    process.env.CI = 'true';

    const $silent = $({ mirror: false, capture: true });
    const result = await $silent`echo hello`;

    assert.strictEqual(result.stdout.trim(), 'hello');
    assert.strictEqual(result.code, 0);
  });
});
