// Finite cross-runtime probe: cancellation must terminate native stage trees.
import assert from 'node:assert/strict';
import { mkdtemp, access, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import $ from '../../js/src/$.mjs';

if (process.platform !== 'win32') {
  const dir = await mkdtemp(join(tmpdir(), 'command-pipeline-cancel-'));
  const marker = join(dir, 'survived');
  const fixture = join(dir, 'child.cjs');
  const source = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    setTimeout(() => {
      fs.writeFileSync(process.env.CANCEL_MARKER, 'survived');
      process.exit(0);
    }, 500);
    console.log('ready');
  `;
  await writeFile(fixture, source);
  $.create('cancel-prefix-fixture', async function* () {
    yield 'prefix';
  });
  try {
    const runner = $({
      mirror: false,
      capture: false,
      killGrace: 50,
      env: { ...process.env, CANCEL_MARKER: marker },
    })`cancel-prefix-fixture | ${process.execPath} ${fixture} | ${process.execPath} -e 'process.stdin.pipe(process.stdout)'`;
    const output = runner.stream();
    const first = await output.next();
    assert.equal(first.value.type, 'stdout', first.value.data?.toString());
    assert.match(first.value.data.toString(), /ready/);
    await output.return();
    // The fixture exits by itself in 500ms even when cancellation is broken.
    await new Promise((resolve) => setTimeout(resolve, 650));
    const survived = await access(marker).then(
      () => true,
      () => false
    );
    assert.equal(
      survived,
      false,
      'native stage survived pipeline cancellation'
    );
    assert.equal(runner.result.signal, 'SIGTERM');
    console.log(
      JSON.stringify({
        runtime: process.versions.bun ? 'bun' : 'node',
        survived,
      })
    );
  } finally {
    $.unregister('cancel-prefix-fixture');
    await rm(dir, { recursive: true, force: true });
  }
}
