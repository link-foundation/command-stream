import { spawn as nativeSpawn, spawnSync } from 'node:child_process';
declare const spawn: typeof nativeSpawn & {
  spawn: typeof nativeSpawn;
  sync: typeof spawnSync;
};
export = spawn;
