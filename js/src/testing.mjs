import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { virtualCommands } from './$.state.mjs';
import { stream } from './stream-processing.mjs';

export const testing = {
  async withMocks(mocks, callback) {
    const entries = Object.entries(mocks);
    if (
      entries.some(
        ([, value]) =>
          value === null ||
          value === undefined ||
          (typeof value !== 'function' && typeof value !== 'object')
      )
    ) {
      throw new TypeError('Invalid command mock');
    }
    const previous = new Map(
      entries.map(([name]) => [name, virtualCommands.get(name)])
    );
    const calls = [];
    try {
      for (const [name, value] of entries) {
        virtualCommands.set(name, (context) => {
          calls.push({ name, context });
          return typeof value === 'function'
            ? value(context)
            : { code: 0, ...value };
        });
      }
      return await callback(calls);
    } finally {
      for (const [name, handler] of previous) {
        if (handler) {
          virtualCommands.set(name, handler);
        } else {
          virtualCommands.delete(name);
        }
      }
    }
  },
  async expectOutput(result, expected, code = 0) {
    result = await result;
    assert.equal(result.code, code);
    assert.equal(await result.text(), expected);
  },
  async expectPipeline(source, expected) {
    assert.deepEqual(await stream(source).toArray(), expected);
  },
  async snapshot(file, value, { update = false } = {}) {
    const data = `${JSON.stringify(value, null, 2)}\n`;
    if (update) {
      await writeFile(file, data);
      return;
    }
    assert.equal(
      await readFile(file, 'utf8'),
      data,
      `Snapshot differs: ${file}`
    );
  },
};
