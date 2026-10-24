import { describe, test, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import ps, {
  lookup,
  lookupSync,
  tree,
  treeSync,
  kill,
  parsePsOutput,
} from '../../src/zx/vendor/ps.mjs';

const SLEEP = 'setTimeout(()=>{},10000)';
const PARENT = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(
  SLEEP
)}], {stdio: 'ignore'}); ${SLEEP}`;

const spawned = [];

function start(script) {
  const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
  spawned.push(child);
  return child;
}

const alive = (pid) => lookupSync({ pid }).length > 0;

async function waitFor(fn, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value || Date.now() - started > timeoutMs) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('vendor/ps', () => {
  after(() => {
    for (const child of spawned) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  });

  test('exposes the @webpod/ps API', () => {
    for (const name of ['lookup', 'lookupSync', 'tree', 'treeSync', 'kill']) {
      assert.equal(typeof ps[name], 'function', name);
    }
  });

  test('parses ps output', () => {
    const list = parsePsOutput(
      '  PID  PPID ARGS\n    1     0 /sbin/init splash\n   42     1 node -e x\n'
    );
    assert.deepEqual(list, [
      { pid: '1', ppid: '0', command: '/sbin/init', arguments: ['splash'] },
      { pid: '42', ppid: '1', command: 'node', arguments: ['-e', 'x'] },
    ]);
  });

  test('looks up a process by pid', async () => {
    const child = start(SLEEP);
    const [entry] = await lookup({ pid: child.pid });
    assert.ok(entry, 'process should be listed');
    assert.equal(entry.pid, String(child.pid));
    assert.equal(entry.ppid, String(process.pid));
    assert.equal(typeof entry.command, 'string');
    assert.ok(Array.isArray(entry.arguments));
    const [syncEntry] = lookupSync({ pid: child.pid });
    assert.equal(syncEntry.pid, String(child.pid));
  });

  test('finds children and descendants', async () => {
    const parent = start(PARENT);
    const children = await waitFor(async () => {
      const list = await tree({ pid: parent.pid, recursive: true });
      return list.length > 0 && list;
    });
    assert.ok(children, 'grandchild should appear in the tree');
    // Recursive listings may include deeper descendants (conhost on Windows).
    assert.ok(children.some((p) => p.ppid === String(parent.pid)));
    const mine = await tree(process.pid);
    assert.ok(mine.some((p) => p.pid === String(parent.pid)));
    const deep = treeSync({ pid: process.pid, recursive: true });
    assert.ok(deep.some((p) => p.pid === children[0].pid));
    for (const p of children) {
      process.kill(Number(p.pid));
    }
  });

  test('kills a process', async () => {
    const child = start(SLEEP);
    assert.equal(alive(child.pid), true);
    const res = await kill(child.pid, { timeout: 4 });
    assert.equal(res, String(child.pid));
    assert.equal(alive(child.pid), false);
    await assert.rejects(kill('not-a-pid'), /Invalid pid/);
  });
});
