import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function mkdir({ args, stdin, cwd }) {
  const argError = VirtualUtils.validateArgs(args, 1, 'mkdir');
  if (argError) return argError;

  // Parse flags and paths
  const flags = new Set();
  const paths = [];
  
  for (const arg of args) {
    if (arg === '-p' || arg === '--parents') {
      flags.add('p');
    } else if (arg.startsWith('-')) {
      for (const flag of arg.slice(1)) {
        flags.add(flag);
      }
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) {
    return VirtualUtils.missingOperandError('mkdir');
  }

  const recursive = flags.has('p');
  
  try {
    for (const dir of paths) {
      const resolvedPath = VirtualUtils.resolvePath(dir, cwd);
      trace('VirtualCommand', () => `mkdir: creating | ${JSON.stringify({ dir: resolvedPath, recursive }, null, 2)}`);
      fs.mkdirSync(resolvedPath, { recursive });
    }
    trace('VirtualCommand', () => `mkdir: success | ${JSON.stringify({ dirsCreated: paths.length }, null, 2)}`);
    return VirtualUtils.success();
  } catch (error) {
    trace('VirtualCommand', () => `mkdir: error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    if (error.code === 'EEXIST') {
      return VirtualUtils.error(`mkdir: cannot create directory '${paths[0]}': File exists`);
    }
    return VirtualUtils.error(`mkdir: ${error.message}`);
  }
}