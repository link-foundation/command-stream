// spawnDetached() starts a command that outlives the caller and returns its pid.
import fs from 'fs';
import path from 'path';
import { spawnDetached } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';

await example(
  { id: 'detached', title: 'Fire-and-forget background commands' },
  async ({ record }) => {
    const dir = makeTempDir('detached');
    const marker = path.join(dir, 'done.txt');

    // Resolves as soon as the process has spawned; it is not awaited.
    const { pid } = await spawnDetached(
      'sleep 0.2 && echo finished > done.txt',
      {
        cwd: dir,
      }
    );
    record('pid is a number', Number.isInteger(pid) && pid > 0);
    record('still running when spawnDetached resolves', !fs.existsSync(marker));

    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    record(
      'what the background command wrote',
      fs.readFileSync(marker, 'utf8')
    );
  }
);
