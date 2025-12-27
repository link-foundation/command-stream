import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function touch({ args, stdin, cwd }) {
  const argError = VirtualUtils.validateArgs(args, 1, 'touch');
  if (argError) {
    return VirtualUtils.missingOperandError(
      'touch',
      'touch: missing file operand'
    );
  }

  try {
    for (const file of args) {
      const resolvedPath = VirtualUtils.resolvePath(file, cwd);
      trace(
        'VirtualCommand',
        () =>
          `touch: processing | ${JSON.stringify({ file: resolvedPath }, null, 2)}`
      );

      const now = new Date();

      try {
        // Try to update existing file's timestamp
        fs.utimesSync(resolvedPath, now, now);
        trace(
          'VirtualCommand',
          () =>
            `touch: updated timestamp | ${JSON.stringify({ file: resolvedPath }, null, 2)}`
        );
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, create it
          fs.writeFileSync(resolvedPath, '');
          trace(
            'VirtualCommand',
            () =>
              `touch: created file | ${JSON.stringify({ file: resolvedPath }, null, 2)}`
          );
        } else {
          throw error;
        }
      }
    }

    trace(
      'VirtualCommand',
      () =>
        `touch: success | ${JSON.stringify({ filesTouched: args.length }, null, 2)}`
    );
    return VirtualUtils.success();
  } catch (error) {
    trace(
      'VirtualCommand',
      () =>
        `touch: error | ${JSON.stringify({ error: error.message }, null, 2)}`
    );
    return VirtualUtils.error(`touch: ${error.message}`);
  }
}
