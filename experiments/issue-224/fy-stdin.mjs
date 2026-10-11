import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command, fy } from '../../js/src/$.mjs';

const dir = await mkdtemp(join(tmpdir(), 'fy-stdin-probe-'));
try {
  const file = join(dir, 'translated.mjs');
  await writeFile(
    file,
    fy('cat; exit 7', {
      module: pathToFileURL(join(process.cwd(), 'js/src/$.mjs')).href,
    })
  );
  for (const runtime of ['node', 'bun']) {
    const result = await command(runtime, file).with({
      stdin: 'input\n',
      env: { ...process.env, COMMAND_STREAM_TRACE: 'true' },
    });
    console.log(
      JSON.stringify({
        runtime,
        code: result.code,
        output: await result.text(),
        trace: String(result.stderr),
      })
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
