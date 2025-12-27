import fs from 'fs';
import path from 'path';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function mv({ args, stdin, cwd }) {
  const argError = VirtualUtils.validateArgs(args, 2, 'mv');
  if (argError) {
    return VirtualUtils.invalidArgumentError(
      'mv',
      'missing destination file operand'
    );
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

  if (paths.length < 2) {
    return VirtualUtils.invalidArgumentError(
      'mv',
      'missing destination file operand'
    );
  }

  const force = flags.has('f');
  const sources = paths.slice(0, -1);
  const destination = paths[paths.length - 1];

  try {
    const destPath = VirtualUtils.resolvePath(destination, cwd);
    let destExists = false;
    let destIsDir = false;

    try {
      const destStats = fs.statSync(destPath);
      destExists = true;
      destIsDir = destStats.isDirectory();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Moving multiple files requires destination to be a directory
    if (sources.length > 1 && destExists && !destIsDir) {
      return VirtualUtils.error(
        `mv: target '${destination}' is not a directory`
      );
    }

    for (const source of sources) {
      const sourcePath = VirtualUtils.resolvePath(source, cwd);

      try {
        const sourceStats = fs.statSync(sourcePath);
        let finalDestPath = destPath;

        if (destIsDir) {
          // Moving into a directory
          finalDestPath = path.join(destPath, path.basename(sourcePath));
        }

        // Check if destination exists and handle force flag
        if (!force) {
          try {
            fs.statSync(finalDestPath);
            // Destination exists and no force flag
            return VirtualUtils.error(
              `mv: cannot move '${source}': File exists`
            );
          } catch (error) {
            if (error.code !== 'ENOENT') {
              throw error;
            }
          }
        }

        trace(
          'VirtualCommand',
          () =>
            `mv: moving | ${JSON.stringify({ from: sourcePath, to: finalDestPath }, null, 2)}`
        );
        fs.renameSync(sourcePath, finalDestPath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return VirtualUtils.error(
            `mv: cannot stat '${source}': No such file or directory`
          );
        }
        throw error;
      }
    }

    trace(
      'VirtualCommand',
      () =>
        `mv: success | ${JSON.stringify({ filesMoved: sources.length }, null, 2)}`
    );
    return VirtualUtils.success();
  } catch (error) {
    trace(
      'VirtualCommand',
      () => `mv: error | ${JSON.stringify({ error: error.message }, null, 2)}`
    );
    return VirtualUtils.error(`mv: ${error.message}`);
  }
}
