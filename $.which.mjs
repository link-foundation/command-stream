import fs from 'fs';
import path from 'path';
import { VirtualUtils } from './$.utils.mjs';

export default function createWhichCommand(virtualCommands) {
  return async function which({ args }) {
    const argError = VirtualUtils.validateArgs(args, 1, 'which');
    if (argError) return argError;

    const cmd = args[0];

    if (virtualCommands.has(cmd)) {
      return VirtualUtils.success(`${cmd}: shell builtin\n`);
    }

    const paths = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
    const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];

    for (const pathDir of paths) {
      for (const ext of extensions) {
        const fullPath = path.join(pathDir, cmd + ext);
        try {
          if (fs.statSync(fullPath).isFile()) {
            return VirtualUtils.success(fullPath + '\n');
          }
        } catch { }
      }
    }

    return VirtualUtils.error(`which: no ${cmd} in PATH`);
  };
}