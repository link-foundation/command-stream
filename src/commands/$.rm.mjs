import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function rm({ args, stdin, cwd }) {
  const argError = VirtualUtils.validateArgs(args, 1, 'rm');
  if (argError) {
    return argError;
  }

  // Parse flags and paths
  const flags = new Set();
  const paths = [];

  for (const arg of args) {
    if (arg.startsWith('-')) {
      for (const flag of arg.slice(1)) {
        flags.add(flag);
      }
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) {
    return VirtualUtils.missingOperandError('rm');
  }

  const recursive = flags.has('r') || flags.has('R');
  const force = flags.has('f');

  try {
    for (const file of paths) {
      const resolvedPath = VirtualUtils.resolvePath(file, cwd);
      trace(
        'VirtualCommand',
        () =>
          `rm: removing | ${JSON.stringify({ file: resolvedPath, recursive, force }, null, 2)}`
      );

      try {
        const stats = fs.statSync(resolvedPath);
        if (stats.isDirectory() && !recursive) {
          return VirtualUtils.error(
            `rm: cannot remove '${file}': Is a directory`
          );
        }

        if (stats.isDirectory()) {
          fs.rmSync(resolvedPath, { recursive: true, force });
        } else {
          fs.unlinkSync(resolvedPath);
        }
      } catch (error) {
        if (error.code === 'ENOENT' && !force) {
          return VirtualUtils.error(
            `rm: cannot remove '${file}': No such file or directory`
          );
        } else if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    trace(
      'VirtualCommand',
      () =>
        `rm: success | ${JSON.stringify({ filesRemoved: paths.length }, null, 2)}`
    );
    return VirtualUtils.success();
  } catch (error) {
    trace(
      'VirtualCommand',
      () => `rm: error | ${JSON.stringify({ error: error.message }, null, 2)}`
    );
    return VirtualUtils.error(`rm: ${error.message}`);
  }
}
